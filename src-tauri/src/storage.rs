// Minimal secure storage for optional future use (e.g. OpenClaw token).
// No license or Pluely API; keys are stored in app data JSON.
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use tauri::{AppHandle, Manager};

fn get_secure_storage_path(app: &AppHandle) -> Result<PathBuf, String> {
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data directory: {}", e))?;
    fs::create_dir_all(&app_data_dir)
        .map_err(|e| format!("Failed to create app data directory: {}", e))?;
    Ok(app_data_dir.join("secure_storage.json"))
}

#[derive(Debug, Serialize, Deserialize, Default)]
struct SecureStorage(HashMap<String, String>);

#[derive(Debug, Serialize, Deserialize)]
pub struct StorageItem {
    pub key: String,
    pub value: String,
}

#[derive(Debug, Serialize, Deserialize, Default)]
pub struct StorageResult {
    pub license_key: Option<String>,
    pub instance_id: Option<String>,
    pub selected_pluely_model: Option<String>,
}

#[tauri::command]
pub async fn secure_storage_save(app: AppHandle, items: Vec<StorageItem>) -> Result<(), String> {
    let storage_path = get_secure_storage_path(&app)?;
    let mut storage: SecureStorage = if storage_path.exists() {
        let content = fs::read_to_string(&storage_path)
            .map_err(|e| format!("Failed to read storage file: {}", e))?;
        serde_json::from_str(&content).unwrap_or_default()
    } else {
        SecureStorage::default()
    };
    for item in items {
        storage.0.insert(item.key, item.value);
    }
    let content = serde_json::to_string(&storage.0)
        .map_err(|e| format!("Failed to serialize storage: {}", e))?;
    fs::write(&storage_path, content)
        .map_err(|e| format!("Failed to write storage file: {}", e))?;
    Ok(())
}

#[tauri::command]
pub async fn secure_storage_get(app: AppHandle) -> Result<StorageResult, String> {
    let storage_path = get_secure_storage_path(&app)?;
    if !storage_path.exists() {
        return Ok(StorageResult::default());
    }
    let content = fs::read_to_string(&storage_path)
        .map_err(|e| format!("Failed to read storage file: {}", e))?;
    let raw: HashMap<String, String> = serde_json::from_str(&content).unwrap_or_default();
    Ok(StorageResult {
        license_key: raw.get("pluely_license_key").cloned(),
        instance_id: raw.get("pluely_instance_id").cloned(),
        selected_pluely_model: raw.get("selected_pluely_model").cloned(),
    })
}

#[tauri::command]
pub async fn secure_storage_remove(app: AppHandle, keys: Vec<String>) -> Result<(), String> {
    let storage_path = get_secure_storage_path(&app)?;
    if !storage_path.exists() {
        return Ok(());
    }
    let content = fs::read_to_string(&storage_path)
        .map_err(|e| format!("Failed to read storage file: {}", e))?;
    let mut raw: HashMap<String, String> = serde_json::from_str(&content).unwrap_or_default();
    for key in keys {
        raw.remove(&key);
    }
    let content = serde_json::to_string(&raw)
        .map_err(|e| format!("Failed to serialize storage: {}", e))?;
    fs::write(&storage_path, content)
        .map_err(|e| format!("Failed to write storage file: {}", e))?;
    Ok(())
}
