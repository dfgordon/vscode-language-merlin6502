# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [3.0.0] - 2024-08-24

### New Features

* Language server is native rust code
* Expanded language diagnostics
    - conditional assembly and folds are handled
    - better handling of 16 bit syntax
    - checks illegal forward references
    - others
* Disk image support is bundled, no need for external `a2kit` installation
* Better disassembly, finds various data patterns, user can set MX
* Spot assembler to convert code sections to data sections as part of disassembly effort
* Includes with the same name are resolved by partially matching ProDOS and local paths

### Breaking Changes

* Platform support works differently
    - Out of the box support for Linux-x64, Mac-x64, Mac-aarch64, and Windows-x64, everything needed is bundled.
    - Universal version requires an external `a2kit` installation, not only for disk images, but for all services.
* Include file search works differently
    - If the workspace contains two files with the same name, the best partial match to the ProDOS path is selected.
    - If there are multiple equally good matches an error is flagged and the include is not analyzed.