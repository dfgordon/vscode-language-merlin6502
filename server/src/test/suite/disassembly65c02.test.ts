import * as config from '../../settings';
import * as lxbase from '../../langExtBase';
import * as com from '../../commands';
import * as assert from 'assert';

function testDisassembler(hexInput: string, expectedCode: string, tool: com.DisassemblyTool) {
    const binary = Buffer.from(hexInput, "hex");
    const actualCode = tool.disassemble(Array.from(binary), {
        getWhat: 'Disassembly: Ranged',
        addrRange: [0, hexInput.length / 2],
        xc: 1,
        label: 'none'
    });
    assert.deepStrictEqual(actualCode, expectedCode);
}

describe('65c02 Disassembly: octet ops', async function() {
	this.beforeEach(async function() {
		const TSInitResult = await lxbase.TreeSitterInit();
		this.disTool = new com.DisassemblyTool(TSInitResult,config.defaultSettings);
	});
	it('adc', async function() {
        const hexInput = '7200';
        const expectedCode =
            '\tADC\t($00)\n';
        testDisassembler(hexInput,expectedCode,this.disTool);
	});
	it('and', async function() {
        const hexInput = '3200';
        const expectedCode =
            '\tAND\t($00)\n';
        testDisassembler(hexInput,expectedCode,this.disTool);
	});
	it('cmp', async function() {
        const hexInput = 'd200';
        const expectedCode =
            '\tCMP\t($00)\n';
        testDisassembler(hexInput,expectedCode,this.disTool);
	});
	it('eor', async function() {
        const hexInput = '5200';
        const expectedCode =
            '\tEOR\t($00)\n';
        testDisassembler(hexInput,expectedCode,this.disTool);
	});
	it('lda', async function() {
        const hexInput = 'b200';
        const expectedCode =
            '\tLDA\t($00)\n';
        testDisassembler(hexInput,expectedCode,this.disTool);
	});
	it('ora', async function() {
        const hexInput = '1200';
        const expectedCode =
            '\tORA\t($00)\n';
        testDisassembler(hexInput,expectedCode,this.disTool);
	});
	it('sbc', async function() {
        const hexInput = 'f200';
        const expectedCode =
            '\tSBC\t($00)\n';
        testDisassembler(hexInput,expectedCode,this.disTool);
	});
});

describe('6502 Disassembly: store ops', async function() {
	this.beforeEach(async function() {
		const TSInitResult = await lxbase.TreeSitterInit();
		this.disTool = new com.DisassemblyTool(TSInitResult,config.defaultSettings);
	});
	it('sta', async function() {
        const hexInput = '9200';
        const expectedCode =
            '\tSTA\t($00)\n';
        testDisassembler(hexInput,expectedCode,this.disTool);
	});
	it('stz', async function() {
        const hexInput = '640074009c00109e0010';
        const expectedCode =
            '\tSTZ\t$00\n' +
            '\tSTZ\t$00,X\n' +
            '\tSTZ\t$1000\n' +
            '\tSTZ\t$1000,X\n';
        testDisassembler(hexInput,expectedCode,this.disTool);
	});
});

describe('6502 Disassembly: branching', async function() {
	this.beforeEach(async function() {
		const TSInitResult = await lxbase.TreeSitterInit();
		this.disTool = new com.DisassemblyTool(TSInitResult,config.defaultSettings);
	});
	it('branch relative', async function() {
        const hexInput = '8000';
        const expectedCode =
            '\tBRA\t$0002\n';
        testDisassembler(hexInput,expectedCode,this.disTool);
	});
	it('jumping', async function() {
        const hexInput = '7c0010';
        const expectedCode =
            '\tJMP\t($1000,X)\n';
        testDisassembler(hexInput,expectedCode,this.disTool);
	});
});

describe('6502 Disassembly: short ops', async function() {
	this.beforeEach(async function() {
		const TSInitResult = await lxbase.TreeSitterInit();
		this.disTool = new com.DisassemblyTool(TSInitResult,config.defaultSettings);
	});
	it('stack', async function() {
        const hexInput = '5a7adafa';
        const expectedCode =
            '\tPHY\n' +
            '\tPLY\n' +
            '\tPHX\n' +
            '\tPLX\n';
        testDisassembler(hexInput,expectedCode,this.disTool);
	});
	it('increment', async function() {
        const hexInput = '1a3a';
        const expectedCode =
            '\tINC\n' +
            '\tDEC\n';
        testDisassembler(hexInput,expectedCode,this.disTool);
	});
});

describe('6502 Disassembly: bitwise', async function() {
	this.beforeEach(async function() {
		const TSInitResult = await lxbase.TreeSitterInit();
		this.disTool = new com.DisassemblyTool(TSInitResult,config.defaultSettings);
	});
	it('bit', async function() {
        const hexInput = '340089003c0010';
        const expectedCode =
            '\tBIT\t$00,X\n' +
            '\tBIT\t#$00\n' +
            '\tBIT\t$1000,X\n';
        testDisassembler(hexInput,expectedCode,this.disTool);
	});
	it('test bits', async function() {
        const hexInput = '040014000c00101c0010';
        const expectedCode =
            '\tTSB\t$00\n' +
            '\tTRB\t$00\n' +
            '\tTSB\t$1000\n' +
            '\tTRB\t$1000\n';
        testDisassembler(hexInput,expectedCode,this.disTool);
	});
});
