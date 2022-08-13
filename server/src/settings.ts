// These are the settings used in the VSCode client.
// Not all are useful to the server.

export interface merlin6502Settings {
	case: {
		caseSensitive: boolean,
		lowerCaseCompletions: boolean
	},
	columns: {
		c1: number,
		c2: number,
		c3: number
	},
	version: string,
	linker: {
		detect: number
	},
	hovers: {
		specialAddresses: boolean,
		mnemonics: boolean,
		pseudo: boolean
	},
	completions: {
		ibas: boolean,
		abas: boolean
	},
	disassembly: {
		brk: boolean
	},
	diagnostics: {
		live: boolean
	},
	trace: {
		server: string
	}
}

export const defaultSettings: merlin6502Settings = {
	case: {
		caseSensitive: false,
		lowerCaseCompletions: false
	},
	columns: {
		c1: 9,
		c2: 6,
		c3: 11
	},
	version: "Merlin 8",
	linker: {
		detect: 0.1
	},
	hovers: {
		specialAddresses: true,
		mnemonics: true,
		pseudo: true
	},
	completions: {
		ibas: false,
		abas: true
	},
	disassembly: {
		brk: false
	},
	diagnostics: {
		live: true
	},
	trace: {
		server: "silent"
	}
};
