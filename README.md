# Merlin 6502

![unit tests](https://github.com/dfgordon/vscode-language-merlin6502/actions/workflows/node.js.yml/badge.svg)

Language support for Merlin 8/16 assembly language for the 6502 family of processors in Visual Studio Code, with extras for Apple II.

Support for Merlin 16+ and [Merlin 32](https://brutaldeluxe.fr/products/crossdevtools/merlin/) is not included at present.

* Semantic highlights true to Merlin 8/16 syntax
* Completions and hovers for all operations and pseudo-operations
* Completions and hovers for Apple II soft switches, ROM routines, etc.
* Insert disassembly from emulator memory
* Transfer source code to and from emulators
* Diagnostics to identify errors and gotchas
* Options : see `Ctrl+Comma` -> `Extensions` -> `Merlin 6502`
* Commands: see `Ctrl+P` -> `merlin6502`
* Activates for file extensions `.asm`, `.S`

<img src="sample/demo-merlin.gif" alt="session capture"/>

## About Columns and Case

Assembly language is organized into lines and columns.  Merlin source files use a single space as the column separator, even though the Merlin editor displays columns at tab stops.  This extension will accept any combination of spaces and tabs as the column separator.  You can set the indentation (`Ctrl+P` -> `Indent Using ...`) to 9 in order to mimic the *display* layout of the Merlin 8 editor.

Merlin labels are case sensitive, while instruction and pseudo-instruction mnemonics are not.  If you want to consider lower case mnemonics an error there is a setting.  When pasting code into Merlin, auto-capitalization settings within Merlin may take effect.

## Apple ][ Special Addresses

The extension knows hundreds of special address locations relevant to Integer BASIC, Applesoft, DOS 3.3, ProDOS, and the Apple ][ ROM.  Hovering over a literal address will display information about any address in the database.  Completions for special addresses are triggered when `$` is entered in the operand column following `EQU` or `=`.

## Merlin 8/16 Syntax

The aim is to emulate Merlin syntax exactly. As of this writing, the following are known exceptions:

* All delimited strings ("dstrings") must be terminated
* Semicolons cannot be used in any label
* The opening bracket `[` cannot be used in any label
* The closing bracket `]` cannot be used in any label, other than as the leading character in a variable

## Processor target and the XC pseudo-operation

In the spirit of the original Merlin, we rely on the `XC` pseudo-operation to enable or disable the various operations and addressing modes associated with the different processor variants. The rules are simple:

* If there is no `XC` in the source, the target is the 6502
* If there is one `XC` at the beginning of the source, the target is the 65C02
* If there are two consecutive `XC` at the beginning of the source, the target is the 65802 (Merlin 8) or 65816 (Merlin 16)

This was the default behavior of Merlin 8.

## PUT and USE files

The extension will register occurrences of includes (`PUT` and `USE`), but will not parse the referenced files.  If the extension finds an undefined label that follows an include, it will be underlined with a warning, rather than an error, since the definition might be in the include.  In making this calculation the extension assumes that `PUT` files do *not* contain macros, per the usual Merlin rules.

## Using with AppleWin

You can transfer code to and from the [AppleWin](https://github.com/AppleWin/AppleWin) emulator.

* Transfer source to Merlin
    - Format the source using `Ctrl-P` to select `merlin6502: Format for copy and paste into Merlin 8`
    - Use the emulator's clipboard functionality to paste the formatted code directly into the Merlin editor
* Insert Disassembly from emulator
    - From [AppleWin](https://github.com/AppleWin/AppleWin), create a save state file by pressing `F11`
    - Return to VS Code, position the cursor at the insertion point, and use `Ctrl-P` to select `merlin6502: Insert from AppleWin save state`
    - Select `Disassembly` and respond to the subsequent prompts
    - Select the save state file
* Insert Merlin Source
    - Open the source file in Merlin and create a save state file by pressing `F11`
    - Return to VS Code, position the cursor at the insertion point, and use `Ctrl-P` to select `merlin6502: Insert from AppleWin save state`
    - Select `Merlin Source`
    - Select the save state file

Operations with the state file are the same on any platform, but [AppleWin](https://github.com/AppleWin/AppleWin) itself is native to Windows.  Note that [AppleWin](https://github.com/AppleWin/AppleWin) is not part of the extension, and must be installed separately.

## Using with Virtual ][

You can transfer code to and from the [Virtual \]\[](https://virtualii.com) emulator.

* Transfer source to Merlin
    - Format the source using `Ctrl-P` to select `merlin6502: Format for copy and paste into Merlin 8`
    - Use the emulator's clipboard functionality to paste the formatted code directly into the Merlin editor
* Insert Disassembly
    - Put the emulator in the desired state and leave it running
    - Return to VS Code, position the cursor at the insertion point, and use `Ctrl-P` to select `merlin6502: Insert from Virtual ][ front machine`
    - Select `Disassembly` and respond to the subsequent prompts
* Insert Merlin Source
    - Open the source file in Merlin and leave the emulator running
    - Return to VS Code, position the cursor at the insertion point, and use `Ctrl-P` to select `merlin6502: Insert from Virtual ][ front machine`
    - Select `Merlin Source`

This capability only applies to MacOS. Note that [Virtual \]\[](https://virtualii.com) is not part of the extension, and must be installed separately.

## Troubleshooting Tips

* Disassembly
    - verify that the starting address is aligned with an instruction opcode
    - stop disassembly before start of data
* Merlin
    - restore the configuration defaults, especially memory banks
    - use the 128K version of Merlin 8
