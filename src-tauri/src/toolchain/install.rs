use super::{
    archive::{extract_requested_members, ArchiveMemberRequest},
    relative_manifest_tool_path, tool_paths_from_manifest, ManifestTarget, ManifestTool,
    ManifestToolKind, ToolInstallProgress, ToolPaths,
};
use reqwest::blocking::Client;
use sha2::{Digest, Sha256};
use std::{
    fs,
    io::{Read, Write},
    path::{Path, PathBuf},
    time::{Duration, SystemTime, UNIX_EPOCH},
};

const TOOL_DOWNLOAD_MAX_ATTEMPTS: usize = 3;

pub trait ProgressReporter {
    fn emit(&self, progress: ToolInstallProgress);
}

pub struct NoopProgressReporter;

impl ProgressReporter for NoopProgressReporter {
    fn emit(&self, _progress: ToolInstallProgress) {}
}

pub struct InstallTargetRequest<'a> {
    pub target: &'a ManifestTarget,
    pub install_root: &'a Path,
    pub temp_root: &'a Path,
    pub reporter: &'a dyn ProgressReporter,
}

pub fn install_target(request: InstallTargetRequest<'_>) -> Result<ToolPaths, String> {
    fs::create_dir_all(request.install_root).map_err(|error| {
        format!(
            "Failed to prepare tool directory {}: {error}",
            request.install_root.display()
        )
    })?;
    fs::create_dir_all(request.temp_root).map_err(|error| {
        format!(
            "Failed to prepare tool download directory {}: {error}",
            request.temp_root.display()
        )
    })?;
    request.reporter.emit(ToolInstallProgress {
        percent: Some(0.0),
        status: format!("Installing toolchain for {}", request.target.target),
        tool: None,
    });

    let mut zip_groups = Vec::<Vec<&ManifestTool>>::new();
    for tool in &request.target.tools {
        match tool.kind {
            ManifestToolKind::File => install_file_tool(&request, tool)
                .map_err(|error| format!("Failed to install {}: {error}", tool.name))?,
            ManifestToolKind::Zip => {
                if let Some(group) = zip_groups.iter_mut().find(|group| {
                    group
                        .first()
                        .is_some_and(|first| first.source_url == tool.source_url)
                }) {
                    group.push(tool);
                } else {
                    zip_groups.push(vec![tool]);
                }
            }
        }
    }

    for tools in zip_groups {
        let label = zip_group_label(&tools);
        install_zip_tools(&request, &tools)
            .map_err(|error| format!("Failed to install {label}: {error}"))?;
    }

    for tool in &request.target.tools {
        let path = request
            .install_root
            .join(relative_manifest_tool_path(tool)?);
        if !path.exists() {
            return Err(format!(
                "Installed tool is missing after install: {}",
                path.display()
            ));
        }
        verify_sha256(&path, &tool.sha256)?;
    }

    let paths = tool_paths_from_manifest(request.install_root, request.target)?;
    request.reporter.emit(ToolInstallProgress {
        percent: Some(100.0),
        status: "Toolchain installed".to_string(),
        tool: None,
    });
    Ok(paths)
}

fn install_file_tool(
    request: &InstallTargetRequest<'_>,
    tool: &ManifestTool,
) -> Result<(), String> {
    let destination = request
        .install_root
        .join(relative_manifest_tool_path(tool)?);
    let temporary = temporary_sibling(&destination, "download");
    remove_partial_download(&temporary);
    let result = (|| {
        download_source_to_file(
            request.reporter,
            &tool.source_url,
            &temporary,
            &format!("Downloading {}", tool.name),
            &tool.name,
        )?;
        request.reporter.emit(ToolInstallProgress {
            percent: None,
            status: format!("Verifying {}", tool.name),
            tool: Some(tool.name.clone()),
        });
        verify_manifest_source(&temporary, tool)?;
        verify_sha256(&temporary, &tool.sha256)?;
        mark_executable(&temporary)?;
        replace_file(&temporary, &destination, &tool.name)
    })();
    if result.is_err() {
        remove_partial_download(&temporary);
    }
    result
}

fn install_zip_tools(
    request: &InstallTargetRequest<'_>,
    tools: &[&ManifestTool],
) -> Result<(), String> {
    let first = tools
        .first()
        .ok_or_else(|| "Zip tool group cannot be empty".to_string())?;
    let nonce = unique_nonce();
    let archive_path = request
        .temp_root
        .join(format!("{}-{nonce}.zip", sanitize_file_name(&first.name)));
    download_source_to_file(
        request.reporter,
        &first.source_url,
        &archive_path,
        &format!("Downloading {}", zip_group_label(tools)),
        &first.name,
    )?;
    verify_manifest_source(&archive_path, first)?;

    let temporary_paths = tools
        .iter()
        .map(|tool| {
            let destination = request
                .install_root
                .join(relative_manifest_tool_path(tool)?);
            Ok((
                destination.clone(),
                temporary_sibling(&destination, "extract"),
            ))
        })
        .collect::<Result<Vec<_>, String>>()?;
    for (_, temporary) in &temporary_paths {
        remove_partial_download(temporary);
    }

    let result = (|| {
        let members = tools
            .iter()
            .zip(&temporary_paths)
            .map(|(tool, (_, temporary))| {
                let suffix = tool
                    .archive_path_suffix
                    .as_deref()
                    .ok_or_else(|| format!("{} is missing archivePathSuffix", tool.name))?;
                request.reporter.emit(ToolInstallProgress {
                    percent: None,
                    status: format!("Extracting {}", tool.name),
                    tool: Some(tool.name.clone()),
                });
                Ok(ArchiveMemberRequest {
                    label: &tool.name,
                    suffix,
                    destination: temporary,
                })
            })
            .collect::<Result<Vec<_>, String>>()?;
        extract_requested_members(&archive_path, &members)?;

        for (tool, (destination, temporary)) in tools.iter().zip(&temporary_paths) {
            verify_sha256(temporary, &tool.sha256)?;
            mark_executable(temporary)?;
            replace_file(temporary, destination, &tool.name)?;
        }
        Ok(())
    })();

    let _ = fs::remove_file(&archive_path);
    for (_, temporary) in temporary_paths {
        remove_partial_download(&temporary);
    }
    result
}

fn replace_file(source: &Path, destination: &Path, label: &str) -> Result<(), String> {
    if let Some(parent) = destination.parent() {
        fs::create_dir_all(parent).map_err(|error| {
            format!(
                "Failed to prepare directory {} for {label}: {error}",
                parent.display()
            )
        })?;
    }
    if destination.exists() {
        fs::remove_file(destination).map_err(|error| {
            format!(
                "Failed to replace {label} at {}: {error}",
                destination.display()
            )
        })?;
    }
    fs::rename(source, destination).map_err(|error| {
        format!(
            "Failed to move {label} from {} to {}: {error}",
            source.display(),
            destination.display()
        )
    })
}

fn download_source_to_file(
    reporter: &dyn ProgressReporter,
    source_url: &str,
    destination: &Path,
    status: &str,
    tool_name: &str,
) -> Result<(), String> {
    if let Some(parent) = destination.parent() {
        fs::create_dir_all(parent).map_err(|error| {
            format!(
                "Failed to prepare download directory {}: {error}",
                parent.display()
            )
        })?;
    }
    reporter.emit(ToolInstallProgress {
        percent: None,
        status: status.to_string(),
        tool: Some(tool_name.to_string()),
    });

    let client = build_tool_download_client(tool_name)?;
    for attempt in 1..=TOOL_DOWNLOAD_MAX_ATTEMPTS {
        match download_source_to_file_once(
            reporter,
            &client,
            source_url,
            destination,
            status,
            tool_name,
        ) {
            Ok(()) => {
                reporter.emit(ToolInstallProgress {
                    percent: Some(100.0),
                    status: format!("Downloaded {tool_name}"),
                    tool: Some(tool_name.to_string()),
                });
                return Ok(());
            }
            Err(error) if should_retry_tool_download(&error, attempt) => {
                remove_partial_download(destination);
                reporter.emit(ToolInstallProgress {
                    percent: None,
                    status: format!(
                        "Retrying {tool_name} download ({}/{TOOL_DOWNLOAD_MAX_ATTEMPTS})",
                        attempt + 1
                    ),
                    tool: Some(tool_name.to_string()),
                });
            }
            Err(error) => {
                remove_partial_download(destination);
                return Err(error.message);
            }
        }
    }
    Err(format!("Failed to download {tool_name} from {source_url}"))
}

pub(crate) fn build_tool_download_client(tool_name: &str) -> Result<Client, String> {
    install_rustls_crypto_provider();
    Client::builder()
        .connect_timeout(Duration::from_secs(30))
        .timeout(Duration::from_secs(30 * 60))
        .user_agent(format!("yt-dlp-tauri/{}", env!("CARGO_PKG_VERSION")))
        .build()
        .map_err(|error| format!("Failed to prepare HTTP client for {tool_name}: {error}"))
}

fn download_source_to_file_once(
    reporter: &dyn ProgressReporter,
    client: &Client,
    source_url: &str,
    destination: &Path,
    status: &str,
    tool_name: &str,
) -> Result<(), ToolDownloadError> {
    let mut response = client.get(source_url).send().map_err(|error| {
        ToolDownloadError::retryable(format!(
            "Failed to download {tool_name} from {source_url}: {error}"
        ))
    })?;
    let status_code = response.status();
    if !status_code.is_success() {
        let message = format!("Failed to download {tool_name} from {source_url}: {status_code}");
        return if is_retryable_http_status(status_code.as_u16()) {
            Err(ToolDownloadError::retryable(message))
        } else {
            Err(ToolDownloadError::fatal(message))
        };
    }

    let total_bytes = response.content_length();
    let mut file = fs::File::create(destination).map_err(|error| {
        ToolDownloadError::fatal(format!(
            "Failed to create download file for {tool_name} at {}: {error}",
            destination.display()
        ))
    })?;
    let mut buffer = [0_u8; 64 * 1024];
    let mut downloaded_bytes = 0_u64;
    let mut last_display_percent = None;
    if let Some(percent) = download_progress_percent(0, total_bytes) {
        reporter.emit(ToolInstallProgress {
            percent: Some(percent),
            status: status.to_string(),
            tool: Some(tool_name.to_string()),
        });
        last_display_percent = Some(display_percent_bucket(percent));
    }

    loop {
        let byte_count = response.read(&mut buffer).map_err(|error| {
            ToolDownloadError::retryable(format!(
                "Failed to read HTTP response for {tool_name}: {error}"
            ))
        })?;
        if byte_count == 0 {
            break;
        }
        file.write_all(&buffer[..byte_count]).map_err(|error| {
            ToolDownloadError::fatal(format!(
                "Failed to write downloaded {tool_name} to {}: {error}",
                destination.display()
            ))
        })?;
        downloaded_bytes += byte_count as u64;
        if let Some(percent) = download_progress_percent(downloaded_bytes, total_bytes) {
            let bucket = display_percent_bucket(percent);
            if Some(bucket) != last_display_percent {
                reporter.emit(ToolInstallProgress {
                    percent: Some(percent),
                    status: status.to_string(),
                    tool: Some(tool_name.to_string()),
                });
                last_display_percent = Some(bucket);
            }
        }
    }
    file.flush().map_err(|error| {
        ToolDownloadError::fatal(format!(
            "Failed to flush downloaded {tool_name} to {}: {error}",
            destination.display()
        ))
    })?;
    if total_bytes.is_some_and(|expected| expected != downloaded_bytes) {
        return Err(ToolDownloadError::retryable(format!(
            "Downloaded {downloaded_bytes} bytes for {tool_name}, expected {}",
            total_bytes.unwrap_or_default()
        )));
    }
    Ok(())
}

#[derive(Debug)]
struct ToolDownloadError {
    message: String,
    retryable: bool,
}

impl ToolDownloadError {
    fn retryable(message: impl Into<String>) -> Self {
        Self {
            message: message.into(),
            retryable: true,
        }
    }

    fn fatal(message: impl Into<String>) -> Self {
        Self {
            message: message.into(),
            retryable: false,
        }
    }
}

fn should_retry_tool_download(error: &ToolDownloadError, attempt: usize) -> bool {
    error.retryable && attempt < TOOL_DOWNLOAD_MAX_ATTEMPTS
}

fn is_retryable_http_status(status: u16) -> bool {
    status == 408 || status == 429 || status >= 500
}

fn install_rustls_crypto_provider() {
    let _ = rustls::crypto::ring::default_provider().install_default();
}

fn download_progress_percent(downloaded: u64, total: Option<u64>) -> Option<f64> {
    let total = total?;
    if total == 0 {
        return None;
    }
    Some((downloaded as f64 / total as f64).clamp(0.0, 1.0) * 100.0)
}

fn display_percent_bucket(percent: f64) -> i64 {
    percent.round() as i64
}

fn remove_partial_download(path: &Path) {
    let _ = fs::remove_file(path);
}

pub(super) fn verify_sha256(path: &Path, expected: &str) -> Result<(), String> {
    let actual = sha256_file(path)?;
    if actual.eq_ignore_ascii_case(expected) {
        Ok(())
    } else {
        Err(format!(
            "SHA-256 mismatch for {}. Expected {}, got {}",
            path.display(),
            expected,
            actual
        ))
    }
}

fn verify_manifest_source(path: &Path, tool: &ManifestTool) -> Result<(), String> {
    match (tool.source_size, tool.source_sha256.as_deref()) {
        (Some(size), Some(sha256)) => verify_source_file(path, size, sha256),
        (None, None) => Ok(()),
        _ => Err(format!(
            "{} has incomplete source integrity metadata",
            tool.name
        )),
    }
}

fn verify_source_file(
    path: &Path,
    expected_size: u64,
    expected_sha256: &str,
) -> Result<(), String> {
    let actual_size = fs::metadata(path).map_err(|error| error.to_string())?.len();
    if actual_size != expected_size {
        return Err(format!(
            "Downloaded source {} has {actual_size} bytes, expected {expected_size}",
            path.display()
        ));
    }
    verify_sha256(path, expected_sha256)
}

fn sha256_file(path: &Path) -> Result<String, String> {
    let mut file = fs::File::open(path).map_err(|error| error.to_string())?;
    let mut hasher = Sha256::new();
    let mut buffer = [0_u8; 64 * 1024];
    loop {
        let count = file.read(&mut buffer).map_err(|error| error.to_string())?;
        if count == 0 {
            break;
        }
        hasher.update(&buffer[..count]);
    }
    Ok(format!("{:x}", hasher.finalize()))
}

fn temporary_sibling(destination: &Path, purpose: &str) -> PathBuf {
    let file_name = destination
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("tool");
    destination.with_file_name(format!(".{file_name}.{purpose}.{}", unique_nonce()))
}

fn unique_nonce() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos()
}

fn sanitize_file_name(value: &str) -> String {
    value
        .chars()
        .map(|character| {
            if character.is_ascii_alphanumeric() || character == '-' || character == '_' {
                character
            } else {
                '-'
            }
        })
        .collect()
}

fn zip_group_label<T: std::borrow::Borrow<ManifestTool>>(tools: &[T]) -> String {
    tools
        .iter()
        .map(|tool| tool.borrow().name.as_str())
        .collect::<Vec<_>>()
        .join(" / ")
}

#[cfg(unix)]
fn mark_executable(path: &Path) -> Result<(), String> {
    use std::os::unix::fs::PermissionsExt;
    let mut permissions = fs::metadata(path)
        .map_err(|error| error.to_string())?
        .permissions();
    permissions.set_mode(0o755);
    fs::set_permissions(path, permissions).map_err(|error| error.to_string())
}

#[cfg(not(unix))]
fn mark_executable(_path: &Path) -> Result<(), String> {
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn maps_downloaded_bytes_to_current_file_percent() {
        assert_eq!(download_progress_percent(25, Some(100)), Some(25.0));
        assert_eq!(download_progress_percent(100, Some(100)), Some(100.0));
        assert_eq!(download_progress_percent(150, Some(100)), Some(100.0));
        assert_eq!(download_progress_percent(25, None), None);
        assert_eq!(download_progress_percent(25, Some(0)), None);
    }

    #[test]
    fn retries_retryable_tool_download_errors_until_max_attempts() {
        let retryable = ToolDownloadError::retryable("network timeout");
        let fatal = ToolDownloadError::fatal("HTTP 404 Not Found");
        assert!(should_retry_tool_download(&retryable, 1));
        assert!(should_retry_tool_download(
            &retryable,
            TOOL_DOWNLOAD_MAX_ATTEMPTS - 1
        ));
        assert!(!should_retry_tool_download(
            &retryable,
            TOOL_DOWNLOAD_MAX_ATTEMPTS
        ));
        assert!(!should_retry_tool_download(&fatal, 1));
    }

    #[test]
    fn source_file_requires_exact_size_and_sha256() {
        let path =
            std::env::temp_dir().join(format!("yt-dlp-tauri-source-integrity-{}", unique_nonce()));
        fs::write(&path, b"archive").unwrap();
        let digest = sha256_file(&path).unwrap();

        assert!(verify_source_file(&path, 7, &digest).is_ok());
        assert!(verify_source_file(&path, 8, &digest)
            .unwrap_err()
            .contains("expected 8"));
        assert!(verify_source_file(&path, 7, &"a".repeat(64))
            .unwrap_err()
            .contains("SHA-256 mismatch"));

        fs::remove_file(path).unwrap();
    }
}
