# Merlin 6502

![unit tests](https://github.com/dfgordon/vscode-language-merlin6502/actions/workflows/node.js.yml/badge.svg)

Language support for Merlin 8/16 assembly language for the 6502 family of processors in Visual Studio Code, with extras for Apple II.

Support for Merlin 16+ and [Merlin 32](https://brutaldeluxe.fr/products/crossdevtools/merlin/) is not included at present.

* Semantic highlights true to Merlin 8/16 syntax
* Completions and hovers for all operations and pseudo-operations
* Completions and hovers for Apple II soft switches, ROM routines, etc.
* Diagnostics to identify errors and gotchas
* Options : see `Ctrl+Comma` -> `Extensions` -> `Merlin 6502`
* Commands: see `Ctrl+P` -> `merlin6502`
* Activates for file extensions `.asm`, `.S`

<img src="sample/demo-merlin.gif" alt="session capture"/>

## Apple ][ Special Addresses

The extension knows hundreds of special address locations relevant to Integer BASIC, Applesoft, DOS 3.3, ProDOS, and the Apple ][ ROM.  Hovering over a literal address will display information about any address in the database.  Completions for special addresses are triggered when `$` is entered in the operand column following `EQU`.

## Using with Emulators

Before pasting your source code into the Merlin editor (e.g., via emulators with clipboard support), run the ``format for copy and paste`` command.  This will create a new document with the correct formatting, i.e., exactly one space between columns.

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