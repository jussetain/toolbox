//! Système de tâches : chaque traitement long tourne dans un thread,
//! publie sa progression via l'événement `job` et peut être annulé.

use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use serde::Serialize;
use serde_json::Value;
use tauri::{AppHandle, Emitter, Manager, State};

#[derive(Default)]
pub struct Jobs {
    next: AtomicU64,
    cancels: Mutex<HashMap<u64, Arc<AtomicBool>>>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct JobEvent {
    pub id: u64,
    pub tool: String,
    /// running | done | error | cancelled
    pub status: &'static str,
    /// 0.0 – 1.0, absent si indéterminé.
    pub progress: Option<f64>,
    pub label: Option<String>,
    pub result: Option<Value>,
    pub error: Option<String>,
    /// Étapes nommées de la tâche et index de l'étape en cours.
    pub stages: Vec<String>,
    pub stage: usize,
}

pub struct JobCtx {
    app: AppHandle,
    id: u64,
    tool: String,
    cancel: Arc<AtomicBool>,
    last_emit: Mutex<Instant>,
    stages: Mutex<(Vec<String>, usize)>,
}

pub struct Cancelled;

impl JobCtx {
    pub fn id(&self) -> u64 {
        self.id
    }

    pub fn app(&self) -> &AppHandle {
        &self.app
    }

    pub fn is_cancelled(&self) -> bool {
        self.cancel.load(Ordering::Relaxed)
    }

    /// Renvoie `Err(Cancelled)` si l'utilisateur a annulé : à propager avec `?`.
    pub fn check(&self) -> Result<(), Cancelled> {
        if self.is_cancelled() { Err(Cancelled) } else { Ok(()) }
    }

    /// Déclare les étapes de la tâche (affichées en frise) et démarre la première.
    pub fn stages(&self, names: &[&str]) {
        *self.stages.lock().unwrap() = (names.iter().map(|s| s.to_string()).collect(), 0);
        self.emit("running", None, None, None, None);
    }

    /// Passe à l'étape `i` (publié immédiatement, progression remise à « indéterminée »).
    pub fn stage(&self, i: usize, label: impl Into<String>) {
        self.stages.lock().unwrap().1 = i;
        *self.last_emit.lock().unwrap() = Instant::now();
        self.emit("running", None, Some(label.into()), None, None);
    }

    /// Publie la progression, limitée à ~20 événements par seconde.
    pub fn progress(&self, fraction: Option<f64>, label: impl Into<String>) {
        let mut last = self.last_emit.lock().unwrap();
        if last.elapsed() < Duration::from_millis(50) && fraction.map_or(true, |f| f < 1.0) {
            return;
        }
        *last = Instant::now();
        self.emit("running", fraction.map(|f| f.clamp(0.0, 1.0)), Some(label.into()), None, None);
    }

    fn emit(&self, status: &'static str, progress: Option<f64>, label: Option<String>, result: Option<Value>, error: Option<String>) {
        let (stages, stage) = self.stages.lock().unwrap().clone();
        let _ = self.app.emit(
            "job",
            JobEvent { id: self.id, tool: self.tool.clone(), status, progress, label, result, error, stages, stage },
        );
    }
}

pub enum JobError {
    Cancelled,
    Failed(String),
}

impl From<Cancelled> for JobError {
    fn from(_: Cancelled) -> Self { JobError::Cancelled }
}
impl From<std::io::Error> for JobError {
    fn from(e: std::io::Error) -> Self { JobError::Failed(e.to_string()) }
}
impl From<String> for JobError {
    fn from(e: String) -> Self { JobError::Failed(e) }
}

/// Lance `work` dans un thread et retourne l'identifiant de la tâche.
pub fn spawn<F>(app: &AppHandle, tool: &str, work: F) -> u64
where
    F: FnOnce(&JobCtx) -> Result<Value, JobError> + Send + 'static,
{
    let jobs = app.state::<Jobs>();
    let id = jobs.next.fetch_add(1, Ordering::Relaxed) + 1;
    let cancel = Arc::new(AtomicBool::new(false));
    jobs.cancels.lock().unwrap().insert(id, cancel.clone());

    let ctx = JobCtx {
        app: app.clone(),
        id,
        tool: tool.to_string(),
        cancel,
        last_emit: Mutex::new(Instant::now() - Duration::from_secs(1)),
        stages: Mutex::new((Vec::new(), 0)),
    };
    std::thread::spawn(move || {
        ctx.emit("running", None, Some("Démarrage…".into()), None, None);
        match work(&ctx) {
            Ok(result) => ctx.emit("done", Some(1.0), None, Some(result), None),
            Err(JobError::Cancelled) => ctx.emit("cancelled", None, None, None, None),
            Err(JobError::Failed(e)) => ctx.emit("error", None, None, None, Some(e)),
        }
        ctx.app.state::<Jobs>().cancels.lock().unwrap().remove(&ctx.id);
    });
    id
}

#[tauri::command]
pub fn cancel_job(id: u64, jobs: State<Jobs>) {
    if let Some(flag) = jobs.cancels.lock().unwrap().get(&id) {
        flag.store(true, Ordering::Relaxed);
    }
}
