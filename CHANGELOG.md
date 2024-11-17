# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [3.2.0] - 2024-11-17

### Fixes

* Fix some issues in disassembly workflows

### New Features

* Disassembly: data sections can be converted back to code
* Guard against excessive workspace scans
    - maximum directory count and recursion depth
    - passes over `build`, `node_modules`, and `target` directories

## [3.1.2] - 2024-09-29

### Fixes

* Repair lower case completions logic, takes effect if:
  - `completions.lowerCase==true && flag.caseSensitive=="ignore"`

## [3.1.1] - 2024-09-15

Replace bundled darwin-arm64 server with the correct version.

This patch will be skipped over by all other platforms.

## [3.1.0] - 2024-09-15

### New Features

* Hovering on an EXT label shows the ENT label's docstring
* `Go to...` commands behave more correctly
    - Using `Go to declarations` on a reference to an EXT goes to the EXT
    - Using `Go to definitions` on a reference to an EXT goes to the ENT
    - Using `Go to...` from any node is valid, e.g., if we start on a definition and ask for definitions the references are returned.  This is the usual VS Code behavior.
* `Rename Symbol` finds primary workspace symbols
* Additional workspace checks

## [3.0.1] - 2024-09-08

### Fixes

* Searching for workspace symbols (ENT labels)
* Correct a bug in rename symbol (still scoped to doc + includes, however)
* Correct a bug in address hovers
* Formatting preserves blank lines

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