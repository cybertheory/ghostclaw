//! Backend proxy for OpenClaw HTTP requests (avoids CORS).
//! Supports one-shot, streaming, and config read/write.

use futures_util::StreamExt;
use std::collections::HashMap;
use tauri::{AppHandle, Emitter};

#[derive(serde::Deserialize)]
pub struct OpenClawRequest {
    pub url: String,
    pub headers: HashMap<String, String>,
    pub body: String,
}

#[derive(serde::Serialize, Clone)]
pub struct OpenClawResponse {
    pub status: u16,
    pub status_text: String,
    pub body: String,
}

/// One-shot request (GET when body empty, POST otherwise). Used for test-connection.
#[tauri::command]
pub async fn openclaw_request(request: OpenClawRequest) -> Result<OpenClawResponse, String> {
    let client = reqwest::Client::new();

    let mut req = if request.body.is_empty() {
        client.get(&request.url)
    } else {
        client.post(&request.url).body(request.body)
    };
    for (k, v) in request.headers {
        req = req.header(k, v);
    }

    let response = req.send().await.map_err(|e| e.to_string())?;
    let status = response.status();
    let status_text = status.canonical_reason().unwrap_or("").to_string();
    let body = response.text().await.map_err(|e| e.to_string())?;

    Ok(OpenClawResponse {
        status: status.as_u16(),
        status_text,
        body,
    })
}

#[derive(serde::Serialize, Clone)]
pub struct StreamChunk {
    pub stream_id: String,
    pub data: String,
    pub done: bool,
    pub error: Option<String>,
}

/// Streaming POST request. Reads SSE chunks and emits `openclaw-stream` events in real time.
#[tauri::command]
pub async fn openclaw_stream(
    app: AppHandle,
    stream_id: String,
    request: OpenClawRequest,
) -> Result<(), String> {
    let client = reqwest::Client::new();

    let mut req = client.post(&request.url).body(request.body);
    for (k, v) in request.headers {
        req = req.header(k, v);
    }

    let response = match req.send().await {
        Ok(r) => r,
        Err(e) => {
            let _ = app.emit(
                "openclaw-stream",
                StreamChunk {
                    stream_id,
                    data: String::new(),
                    done: true,
                    error: Some(e.to_string()),
                },
            );
            return Ok(());
        }
    };

    let status = response.status();
    if !status.is_success() {
        let body = response.text().await.unwrap_or_default();
        let _ = app.emit(
            "openclaw-stream",
            StreamChunk {
                stream_id,
                data: String::new(),
                done: true,
                error: Some(format!("{} {} - {}", status.as_u16(), status.canonical_reason().unwrap_or(""), body)),
            },
        );
        return Ok(());
    }

    let mut stream = response.bytes_stream();
    while let Some(chunk_result) = stream.next().await {
        match chunk_result {
            Ok(bytes) => {
                let text = String::from_utf8_lossy(&bytes).to_string();
                let _ = app.emit(
                    "openclaw-stream",
                    StreamChunk {
                        stream_id: stream_id.clone(),
                        data: text,
                        done: false,
                        error: None,
                    },
                );
            }
            Err(e) => {
                let _ = app.emit(
                    "openclaw-stream",
                    StreamChunk {
                        stream_id: stream_id.clone(),
                        data: String::new(),
                        done: true,
                        error: Some(e.to_string()),
                    },
                );
                return Ok(());
            }
        }
    }

    let _ = app.emit(
        "openclaw-stream",
        StreamChunk {
            stream_id,
            data: String::new(),
            done: true,
            error: None,
        },
    );

    Ok(())
}

// --- OpenClaw config file management ---

fn openclaw_config_path() -> Result<std::path::PathBuf, String> {
    let home = std::env::var("HOME")
        .or_else(|_| std::env::var("USERPROFILE"))
        .map_err(|_| "Could not determine home directory".to_string())?;
    Ok(std::path::PathBuf::from(home).join(".openclaw").join("openclaw.json"))
}

#[tauri::command]
pub async fn read_openclaw_config() -> Result<String, String> {
    let path = openclaw_config_path()?;
    std::fs::read_to_string(&path)
        .map_err(|e| format!("Failed to read {}: {}", path.display(), e))
}

#[tauri::command]
pub async fn write_openclaw_config(contents: String) -> Result<(), String> {
    // Validate JSON before writing
    serde_json::from_str::<serde_json::Value>(&contents)
        .map_err(|e| format!("Invalid JSON: {}", e))?;
    let path = openclaw_config_path()?;
    // Backup current file
    if path.exists() {
        let bak = path.with_extension("json.bak");
        let _ = std::fs::copy(&path, &bak);
    }
    std::fs::write(&path, contents.as_bytes())
        .map_err(|e| format!("Failed to write {}: {}", path.display(), e))
}

#[tauri::command]
pub async fn restart_openclaw_gateway() -> Result<String, String> {
    let output = tokio::process::Command::new("openclaw")
        .args(["gateway", "restart"])
        .output()
        .await
        .map_err(|e| format!("Failed to run `openclaw gateway restart`: {}", e))?;
    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).to_string();
    if output.status.success() {
        Ok(format!("{}{}", stdout, stderr).trim().to_string())
    } else {
        Err(format!("Exit {}: {}{}", output.status, stdout, stderr).trim().to_string())
    }
}
