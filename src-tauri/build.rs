fn main() {
    tauri_build::build();
    #[cfg(feature = "steam")]
    copy_steam_redistributable();
}

// Only compiled in when the `steam` Cargo feature is on. The `steamworks` crate links against
// the Steamworks redistributable shared library (steam_api64.dll / libsteam_api.so /
// libsteam_api.dylib), which its own build script already copies next to the *dependency's*
// OUT_DIR so the linker can find it - but that's not where the final game executable lives, so
// without this step the built app fails to launch with a "steam_api64.dll not found" /
// "libsteam_api.so: cannot open shared object file" error. This locates that vendored file
// (via `cargo metadata`, since the exact registry cache path isn't stable/known ahead of time)
// and copies it next to the real output binary, and on Linux also tells the linker to search
// the executable's own directory at runtime (Linux, unlike Windows, doesn't do that by default).
#[cfg(feature = "steam")]
fn copy_steam_redistributable() {
    use std::env;
    use std::fs;
    use std::path::PathBuf;
    use std::process::Command;

    println!("cargo:rerun-if-changed=build.rs");

    let out_dir = PathBuf::from(env::var("OUT_DIR").expect("OUT_DIR not set"));
    // OUT_DIR = target/<profile>/build/<pkg>-<hash>/out -> three levels up is target/<profile>,
    // where the final executable actually lands.
    let target_dir = out_dir
        .ancestors()
        .nth(3)
        .expect("unexpected OUT_DIR layout")
        .to_path_buf();

    let manifest_dir = env::var("CARGO_MANIFEST_DIR").unwrap();
    let cargo = env::var("CARGO").unwrap_or_else(|_| "cargo".into());
    let output = Command::new(&cargo)
        .args(["metadata", "--format-version=1", "--all-features"])
        .current_dir(&manifest_dir)
        .output()
        .expect("failed to run `cargo metadata` to locate the steamworks-sys crate");
    if !output.status.success() {
        println!(
            "cargo:warning=`cargo metadata` failed, could not stage the Steam redistributable: {}",
            String::from_utf8_lossy(&output.stderr)
        );
        return;
    }
    let meta: serde_json::Value =
        serde_json::from_slice(&output.stdout).expect("bad `cargo metadata` JSON");
    let Some(pkg) = meta["packages"]
        .as_array()
        .unwrap()
        .iter()
        .find(|p| p["name"] == "steamworks-sys")
    else {
        println!("cargo:warning=steamworks-sys not found in `cargo metadata` output - is the `steam` feature really enabled?");
        return;
    };
    let sys_manifest = PathBuf::from(pkg["manifest_path"].as_str().unwrap());
    let sdk_dir = sys_manifest
        .parent()
        .unwrap()
        .join("lib/steam/redistributable_bin");

    let triple = env::var("TARGET").unwrap();
    let (rel, files): (&str, &[&str]) = if triple.contains("windows") {
        ("win64", &["steam_api64.dll"])
    } else if triple.contains("darwin") {
        ("osx", &["libsteam_api.dylib"])
    } else if triple.contains("aarch64") {
        ("linuxarm64", &["libsteam_api.so"])
    } else {
        ("linux64", &["libsteam_api.so"])
    };
    let src_dir = sdk_dir.join(rel);
    for f in files {
        let src = src_dir.join(f);
        let dst = target_dir.join(f);
        match fs::copy(&src, &dst) {
            Ok(_) => println!("cargo:warning=staged Steam redistributable: {}", dst.display()),
            Err(e) => println!(
                "cargo:warning=could not copy Steam redistributable {} -> {}: {e}",
                src.display(),
                dst.display()
            ),
        }
    }

    if triple.contains("linux") {
        println!("cargo:rustc-link-arg=-Wl,-rpath,$ORIGIN");
    }
}
