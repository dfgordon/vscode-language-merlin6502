# Updates

## 3.0.0

### New Features

* Language server is native rust code
* Expanded language diagnostics
    - better handling of 16 bit syntax
    - checks illegal forward references
    - checks and provides folding sections (DO, LUP, etc.)
    - others
* Disk image support is bundled, no need for external `a2kit` installation
* Better disassembly, finds various data patterns, user can set MX
* Spot assembler to convert code sections to data sections as part of disassembly effort
* Includes with the same name are resolved by partially matching ProDOS and local paths
* Untitled documents are highlighted (but will be missing some semantics)

### Breaking Changes

* Platform support works differently
    - Out of the box support for Linux-x64, Mac-x64, Mac-aarch64, and Windows-x64.
    - The extension will try to find an externally installed `a2kit 3.x` as a fallback.
* Include file search works differently
    - If the workspace contains two files with the same name, the best partial match to the ProDOS path is selected.
    - If there are multiple equally good matches an error is flagged and the include is not analyzed.