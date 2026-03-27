//! Configuration types for logswarm.
//!
//! All components of the swarm share a single [`Config`] that is loaded from a
//! TOML file located in the `configs/` directory (or a user-supplied path).

use serde::Deserialize;
use std::path::{Path, PathBuf};

/// Root configuration — mirrors the TOML structure in `configs/default.toml`.
#[derive(Debug, Deserialize)]
pub struct Config {
    pub swarm: SwarmConfig,
    pub coordinator: CoordinatorConfig,
    pub worker: WorkerConfig,
    pub logging: LoggingConfig,
    pub assets: AssetsConfig,
}

#[derive(Debug, Deserialize)]
pub struct SwarmConfig {
    /// Number of worker processes (`0` = auto-detect from available CPUs).
    pub workers: usize,
    pub max_queue_size: usize,
}

#[derive(Debug, Deserialize)]
pub struct CoordinatorConfig {
    pub health_check_interval_ms: u64,
    pub worker_timeout_ms: u64,
}

#[derive(Debug, Deserialize)]
pub struct WorkerConfig {
    pub max_concurrent_tasks: usize,
    pub work_dir: PathBuf,
}

#[derive(Debug, Deserialize)]
pub struct LoggingConfig {
    pub level: String,
    pub output: String,
}

#[derive(Debug, Deserialize)]
pub struct AssetsConfig {
    pub dir: PathBuf,
    pub templates_dir: PathBuf,
}

impl Config {
    /// Load a [`Config`] from the TOML file at `path`.
    pub fn load(path: &Path) -> Result<Self, Box<dyn std::error::Error>> {
        let contents = std::fs::read_to_string(path)?;
        let config: Config = toml::from_str(&contents)?;
        Ok(config)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn load_default_config() {
        let path = Path::new(env!("CARGO_MANIFEST_DIR")).join("configs/default.toml");
        let config = Config::load(&path).expect("failed to load default config");

        assert_eq!(config.swarm.workers, 0);
        assert_eq!(config.swarm.max_queue_size, 1024);
        assert_eq!(config.coordinator.health_check_interval_ms, 5000);
        assert_eq!(config.worker.max_concurrent_tasks, 4);
        assert_eq!(config.logging.level, "info");
        assert_eq!(config.assets.dir, PathBuf::from("assets"));
    }
}
