//! Moniteur de ressources : processeur, mémoire, disques, réseau, applis gourmandes.

use std::collections::HashMap;
use std::sync::Mutex;
use std::time::Instant;

use serde_json::{json, Value};
use sysinfo::{Disks, Networks, Pid, ProcessRefreshKind, ProcessesToUpdate, System};
use tauri::State;

pub struct Monitor {
    sys: System,
    disks: Disks,
    nets: Networks,
    last: Instant,
    last_disks: Instant,
}

#[derive(Default)]
pub struct MonitorState(Mutex<Option<Monitor>>);

/// Nom affiché d'un processus : sans « .exe ».
pub fn display_name(raw: &str) -> String {
    let n = raw.strip_suffix(".exe").or_else(|| raw.strip_suffix(".EXE")).unwrap_or(raw);
    n.to_string()
}

/// Regroupe les processus par nom (comme le Gestionnaire des tâches) et trie par processeur puis mémoire.
pub fn aggregate(procs: impl Iterator<Item = (u32, String, f32, u64)>, cores: usize) -> Vec<Value> {
    let mut groups: HashMap<String, (f32, u64, Vec<u32>)> = HashMap::new();
    for (pid, name, cpu, mem) in procs {
        let g = groups.entry(display_name(&name)).or_default();
        g.0 += cpu;
        g.1 += mem;
        g.2.push(pid);
    }
    let mut v: Vec<_> = groups.into_iter().collect();
    v.sort_by(|a, b| b.1 .0.total_cmp(&a.1 .0).then(b.1 .1.cmp(&a.1 .1)));
    v.into_iter()
        .map(|(name, (cpu, mem, pids))| json!({ "name": name, "cpu": cpu / cores.max(1) as f32, "memory": mem, "count": pids.len(), "pids": pids }))
        .collect()
}

/// Instantané : à appeler environ chaque seconde (l'usage processeur se mesure entre deux appels).
#[tauri::command]
pub fn system_snapshot(state: State<MonitorState>) -> Value {
    let mut guard = state.0.lock().unwrap();
    let first = guard.is_none();
    let m = guard.get_or_insert_with(|| Monitor {
        sys: System::new_all(),
        disks: Disks::new_with_refreshed_list(),
        nets: Networks::new_with_refreshed_list(),
        last: Instant::now(),
        last_disks: Instant::now(),
    });
    let dt = m.last.elapsed().as_secs_f64().max(0.2);
    m.last = Instant::now();
    m.sys.refresh_cpu_usage();
    m.sys.refresh_memory();
    m.sys.refresh_processes_specifics(ProcessesToUpdate::All, true, ProcessRefreshKind::nothing().with_cpu().with_memory());
    m.nets.refresh(true);
    if m.last_disks.elapsed().as_secs() >= 5 {
        m.disks.refresh(true);
        m.last_disks = Instant::now();
    }
    let cores = m.sys.cpus().len();
    let (rx, tx) = m.nets.iter().fold((0u64, 0u64), |(r, t), (_, d)| (r + d.received(), t + d.transmitted()));
    let own = std::process::id();
    let procs = aggregate(
        m.sys.processes().iter().filter(|(pid, _)| pid.as_u32() != 0).map(|(pid, p)| (pid.as_u32(), p.name().to_string_lossy().into_owned(), p.cpu_usage(), p.memory())),
        cores,
    );
    let mut seen = std::collections::HashSet::new();
    let disks: Vec<Value> = m.disks.iter()
        .filter(|d| d.total_space() > 0 && seen.insert(d.mount_point().to_path_buf()))
        .map(|d| json!({ "mount": d.mount_point().display().to_string(), "name": d.name().to_string_lossy(), "total": d.total_space(), "available": d.available_space(), "removable": d.is_removable() }))
        .collect();
    json!({
        // Premier appel : pas encore d'intervalle de mesure pour le processeur et le réseau.
        "warmup": first,
        "cpu": {
            "total": m.sys.global_cpu_usage(),
            "cores": m.sys.cpus().iter().map(|c| c.cpu_usage()).collect::<Vec<_>>(),
            "brand": m.sys.cpus().first().map(|c| c.brand().trim().to_string()).unwrap_or_default(),
            "frequency": m.sys.cpus().first().map(|c| c.frequency()).unwrap_or(0),
        },
        "memory": { "total": m.sys.total_memory(), "used": m.sys.used_memory(), "available": m.sys.available_memory(), "swapTotal": m.sys.total_swap(), "swapUsed": m.sys.used_swap() },
        "network": { "rx": if first { 0.0 } else { rx as f64 / dt }, "tx": if first { 0.0 } else { tx as f64 / dt } },
        "disks": disks,
        "processCount": m.sys.processes().len(),
        "uptime": System::uptime(),
        "processes": procs.into_iter().take(60).collect::<Vec<_>>(),
        "self": own,
    })
}

/// Ferme les processus donnés (une appli regroupée = plusieurs processus). Renvoie le nombre fermé.
#[tauri::command]
pub fn process_kill(state: State<MonitorState>, pids: Vec<u32>) -> Result<usize, String> {
    let own = std::process::id();
    if pids.contains(&own) {
        return Err("Toolbox ne peut pas se fermer lui-même ici.".into());
    }
    let guard = state.0.lock().unwrap();
    let m = guard.as_ref().ok_or("Moniteur non démarré.")?;
    let n = pids.iter().filter(|p| m.sys.process(Pid::from_u32(**p)).map(|p| p.kill()).unwrap_or(false)).count();
    if n == 0 {
        return Err("Windows a refusé : ce processus est protégé ou appartient au système.".into());
    }
    Ok(n)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn groups_by_name() {
        let v = aggregate(
            vec![(1, "chrome.exe".into(), 50.0, 100), (2, "chrome.exe".into(), 30.0, 200), (3, "code.exe".into(), 90.0, 10), (4, "idle".into(), 0.0, 999)].into_iter(),
            4,
        );
        assert_eq!(v[0]["name"], "code");
        assert_eq!(v[1]["name"], "chrome");
        assert_eq!(v[1]["count"], 2);
        assert_eq!(v[1]["memory"], 300);
        assert_eq!(v[1]["cpu"], 20.0);
        assert_eq!(v[2]["name"], "idle");
    }

    #[test]
    fn snapshot_reads_this_machine() {
        let mut sys = System::new_all();
        sys.refresh_cpu_usage();
        assert!(sys.total_memory() > 0);
        assert!(!sys.cpus().is_empty());
    }
}
