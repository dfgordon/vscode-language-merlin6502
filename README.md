# Merlin 6502

![unit tests](https://github.com/dfgordon/vscode-language-merlin6502/actions/workflows/node.js.yml/badge.svg)

Language support for Merlin 8/16/16+/32 assembly language for the 6502 family of processors in Visual Studio Code, with extras for Apple II.

*latest features*: rename symbol, live diagnostics optional, format as you type, goto references

* Conforms to choice of Merlin version and processor target
* Resolves labels across project workspace
* Comprehensive highlights, completions, and hovers
* Completions and hovers for Apple II soft switches, ROM routines, etc.
* Insert disassembly from emulator memory
* Transfer source code to and from emulators
* Diagnostics to identify errors and gotchas
* Options : see `Ctrl+Comma` -> `Extensions` -> `Merlin 6502`
* Commands: see `Ctrl+P` -> `merlin6502`
* Activates for file extensions `.asm`, `.S`

<img src="sample/demo-merlin.gif" alt="session capture"/>

## Merlin Syntax Settings

Use extension settings (`Ctrl+Comma`, `Extensions`, `merlin6502`) to select the Merlin version.  This allows the extension to provide targeted diagnostics and completions.

There are a few syntax rules that are *always* enforced by the extension, and which may be more restrictive than a given Merlin version:

* All delimited strings ("dstrings") must be terminated
* The characters `;[{}<>=` cannot be used in any label
* The character `]` cannot be used in any label, except to start a variable
* If the whole line is a comment, the first character must be `*`

## About Columns and Case

Assembly language is organized into lines and columns.  Merlin source files use a single space as the column separator, even though the Merlin editor displays columns at tab stops.  This extension will accept any combination of spaces and tabs as the column separator.  The use of flexible column separators means that if some columns are empty, context-free counting of columns is not possible.  In practice, all you have to keep in mind is that comments must appear *last*, rather than in a particular column.  Formatting columns can be done in three ways:

* **on tab**: Setting the indentation (`Ctrl+P` -> `Indent Using ...`) to 8 is a fair choice if you want to use tabs for column positioning.

* **on space**: If you activate `Text Editor` -> `Formatting` -> `Format On Type`, then upon typing a space, the extension will advance the cursor to the variable tab stops that are defined in extension settings.  If there is an operand completion, it will be shifted after it is accepted.  Note the formatting in this mode only works in the forward direction.

* **on command**: Using `Format Document` or `Format Selection`, will apply the variable column widths defined in extension settings.

Merlin labels are case sensitive, while instruction and pseudo-instruction mnemonics are not.  There are settings to control the behavior of completions and diagnostics with respect to case.  When pasting code into Merlin, auto-capitalization settings within Merlin may take effect.

## Apple ][ Special Addresses

The extension knows hundreds of special address locations relevant to Integer BASIC, Applesoft, DOS 3.3, ProDOS, and the Apple ][ ROM.  Hovering over a literal address will display information about any address in the database.  Completions for special addresses are triggered when `$` is entered in the operand column following `EQU` or `=`.

## Operand Completions

If you want to be offered completions for available addressing modes or certain pseudo-op arguments, press space after accepting the completion in the instruction column.  Select the operand you want, and tab your way through the resulting snippet in the usual VS Code fashion.  You can use `Format Document` periodically to move completed operands to the tab stop, if `Format On Type` is not activated.

If you do *not* want to be troubled by operand completions, press tab instead of space, after accepting the instruction.

## Linker Command Files

Merlin linker command files are very similar to source files.  The extension will try to detect linker command files, and treat them specially.  As of this writing, the special treatment is simply turning off certain language services.  The detection threshold for linker commands can be adjusted in settings.

## Linker Modules

The extension will verify that `EXT` and `EXD` labels are declared as `ENT` in another module.  It does not analyze linker command files for consistency, it only verifies that the external label has at least one corresponding entry label *somewhere* in the project.  Hovering over the external label shows the corresponding entries.

## PUT and USE files

The extension will fully analyze `PUT` and `USE` includes, assuming it can find the referenced files.  The way the file search works is as follows.  The referenced file in column 3 is assumed to be a ProDOS pathname. The filename is extracted, and a search in the project workspace is carried out for a `.S` file with the same name.  The first match is analyzed.  The following should be noted:

* The ProDOS path and the VS Code project path do not need to match in any way
* If more than one file match is found, the extension will flag it as an error
* The file extension should *not* be included in the pseudo-op argument

## Processor target and the XC pseudo-operation

In the spirit of the original Merlin, we rely on the `XC` pseudo-operation to enable or disable the various operations and addressing modes associated with the different processor variants. The rules depend on the Merlin version:

* Merlin 8
    - Default target = 6502
    - `XC` sets target = 65C02
    - `XC` twice sets target = 65802
* Merlin 16/16+/32
    - Default target = 65816
    - `XC OFF` sets target = 6502
    - `XC OFF` followed by `XC` sets target = 65C02

However, note that `XC OFF` was not introduced until Merlin 16+.  The Merlin 32 assembler appears to ignore `XC`, but you can still use it in the extension for diagnostic purposes.

## Using with AppleWin

You can transfer code to and from the [AppleWin](https://github.com/AppleWin/AppleWin) emulator.

* Transfer source to Merlin
    - Format the source using `Ctrl+P` to select `merlin6502: Format for copy and paste into Merlin 8`
    - Use the emulator's clipboard functionality to paste the formatted code directly into the Merlin editor
* Insert Disassembly from emulator
    - From [AppleWin](https://github.com/AppleWin/AppleWin), create a save state file by pressing `F11`
    - Return to VS Code, position the cursor at the insertion point, and use `Ctrl+P` to select `merlin6502: Insert from AppleWin save state`
    - Select `Disassembly` and respond to the subsequent prompts
    - Select the save state file
* Insert Merlin Source
    - Open the source file in Merlin and create a save state file by pressing `F11`
    - Return to VS Code, position the cursor at the insertion point, and use `Ctrl+P` to select `merlin6502: Insert from AppleWin save state`
    - Select `Merlin Source`
    - Select the save state file

Operations with the state file are the same on any platform, but [AppleWin](https://github.com/AppleWin/AppleWin) itself is native to Windows.  Note that [AppleWin](https://github.com/AppleWin/AppleWin) is not part of the extension, and must be installed separately.

## Using with Virtual ][

You can transfer code to and from the [Virtual \]\[](https://virtualii.com) emulator.

* Transfer source to Merlin
    - Format the source using `Cmd+P` to select `merlin6502: Format for copy and paste into Merlin 8`
    - Use the emulator's clipboard functionality to paste the formatted code directly into the Merlin editor
* Insert Disassembly
    - Put the emulator in the desired state and leave it running
    - Return to VS Code, position the cursor at the insertion point, and use `Cmd+P` to select `merlin6502: Insert from Virtual ][ front machine`
    - Select `Disassembly` and respond to the subsequent prompts
* Insert Merlin Source
    - Open the source file in Merlin and leave the emulator running
    - Return to VS Code, position the cursor at the insertion point, and use `Cmd+P` to select `merlin6502: Insert from Virtual ][ front machine`
    - Select `Merlin Source`

This capability only applies to MacOS. Note that [Virtual \]\[](https://virtualii.com) is not part of the extension, and must be installed separately.

## Troubleshooting Tips

* VS Code
    - when entering hexadecimal into *editor* commands, use the modern convention, e.g. use `0xff` rather than `$ff`.
    - tab your way to the end of snippets
    - to mitigate diagnostic delay, break large source files into smaller modules, or turn off live diagnostics in settings
    - diagnostic updates are forced by new line (live), or saving the document (always)
    - if symbol information doesn't load try forcing a diagnostic update
* Disassembly
    - verify that the starting address is aligned with an instruction opcode
    - stop disassembly before start of data
    - adjust handling of BRK instruction in settings
* Merlin
    - restore the configuration defaults, especially memory banks
    - use the 128K version of Merlin 8
