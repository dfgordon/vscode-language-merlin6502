import * as vscode from 'vscode';
import * as lxbase from '../../langExtBase';
import * as labels from '../../labels';
import * as com from '../../commands';
import * as assert from 'assert';

describe('65c02 Disassembly: octet ops', async function() {
	this.beforeEach(async function() {
		const TSInitResult = await lxbase.TreeSitterInit();
		const labelSentry = new labels.LabelSentry(TSInitResult);
		this.disTool = new com.DisassemblyTool(TSInitResult,labelSentry);
	});
	it('adc', async function() {
        const hexInput = '7200';
        const binaryInput = Buffer.from(hexInput,"hex");
        const expectedCode =
            '\tADC\t($00)\n';
        const actualCode = this.disTool.disassemble(binaryInput,[0,hexInput.length/2],1,'none');
        assert.strictEqual(actualCode,expectedCode);
	});
	it('and', async function() {
        const hexInput = '3200';
        const binaryInput = Buffer.from(hexInput,"hex");
        const expectedCode =
            '\tAND\t($00)\n';
        const actualCode = this.disTool.disassemble(binaryInput,[0,hexInput.length/2],1,'none');
        assert.strictEqual(actualCode,expectedCode);
	});
	it('cmp', async function() {
        const hexInput = 'd200';
        const binaryInput = Buffer.from(hexInput,"hex");
        const expectedCode =
            '\tCMP\t($00)\n';
        const actualCode = this.disTool.disassemble(binaryInput,[0,hexInput.length/2],1,'none');
        assert.strictEqual(actualCode,expectedCode);
	});
	it('eor', async function() {
        const hexInput = '5200';
        const binaryInput = Buffer.from(hexInput,"hex");
        const expectedCode =
            '\tEOR\t($00)\n';
        const actualCode = this.disTool.disassemble(binaryInput,[0,hexInput.length/2],1,'none');
        assert.strictEqual(actualCode,expectedCode);
	});
	it('lda', async function() {
        const hexInput = 'b200';
        const binaryInput = Buffer.from(hexInput,"hex");
        const expectedCode =
            '\tLDA\t($00)\n';
        const actualCode = this.disTool.disassemble(binaryInput,[0,hexInput.length/2],1,'none');
        assert.strictEqual(actualCode,expectedCode);
	});
	it('ora', async function() {
        const hexInput = '1200';
        const binaryInput = Buffer.from(hexInput,"hex");
        const expectedCode =
            '\tORA\t($00)\n';
        const actualCode = this.disTool.disassemble(binaryInput,[0,hexInput.length/2],1,'none');
        assert.strictEqual(actualCode,expectedCode);
	});
	it('sbc', async function() {
        const hexInput = 'f200';
        const binaryInput = Buffer.from(hexInput,"hex");
        const expectedCode =
            '\tSBC\t($00)\n';
        const actualCode = this.disTool.disassemble(binaryInput,[0,hexInput.length/2],1,'none');
        assert.strictEqual(actualCode,expectedCode);
	});
});

describe('6502 Disassembly: store ops', async function() {
	this.beforeEach(async function() {
		const TSInitResult = await lxbase.TreeSitterInit();
		const labelSentry = new labels.LabelSentry(TSInitResult);
		this.disTool = new com.DisassemblyTool(TSInitResult,labelSentry);
	});
	it('sta', async function() {
        const hexInput = '9200';
        const binaryInput = Buffer.from(hexInput,"hex");
        const expectedCode =
            '\tSTA\t($00)\n';
        const actualCode = this.disTool.disassemble(binaryInput,[0,hexInput.length/2],1,'none');
        assert.strictEqual(actualCode,expectedCode);
	});
	it('stz', async function() {
        const hexInput = '640074009c00109e0010';
        const binaryInput = Buffer.from(hexInput,"hex");
        const expectedCode =
            '\tSTZ\t$00\n' +
            '\tSTZ\t$00,X\n' +
            '\tSTZ\t$1000\n' +
            '\tSTZ\t$1000,X\n';
        const actualCode = this.disTool.disassemble(binaryInput,[0,hexInput.length/2],1,'none');
        assert.strictEqual(actualCode,expectedCode);
	});
});

describe('6502 Disassembly: branching', async function() {
	this.beforeEach(async function() {
		const TSInitResult = await lxbase.TreeSitterInit();
		const labelSentry = new labels.LabelSentry(TSInitResult);
		this.disTool = new com.DisassemblyTool(TSInitResult,labelSentry);
	});
	it('branch relative', async function() {
        const hexInput = '8000';
        const binaryInput = Buffer.from(hexInput,"hex");
        const expectedCode =
            '\tBRA\t$0002\n';
        const actualCode = this.disTool.disassemble(binaryInput,[0,hexInput.length/2],1,'none');
        assert.strictEqual(actualCode,expectedCode);
	});
	it('jumping', async function() {
        const hexInput = '7c0010';
        const binaryInput = Buffer.from(hexInput,"hex");
        const expectedCode =
            '\tJMP\t($1000,X)\n';
        const actualCode = this.disTool.disassemble(binaryInput,[0,hexInput.length/2],1,'none');
        assert.strictEqual(actualCode,expectedCode);
	});
});

describe('6502 Disassembly: short ops', async function() {
	this.beforeEach(async function() {
		const TSInitResult = await lxbase.TreeSitterInit();
		const labelSentry = new labels.LabelSentry(TSInitResult);
		this.disTool = new com.DisassemblyTool(TSInitResult,labelSentry);
	});
	it('stack', async function() {
        const hexInput = '5a7adafa';
        const binaryInput = Buffer.from(hexInput,"hex");
        const expectedCode =
            '\tPHY\n' +
            '\tPLY\n' +
            '\tPHX\n' +
            '\tPLX\n';
        const actualCode = this.disTool.disassemble(binaryInput,[0,hexInput.length/2],1,'none');
        assert.strictEqual(actualCode,expectedCode);
	});
	it('increment', async function() {
        const hexInput = '1a3a';
        const binaryInput = Buffer.from(hexInput,"hex");
        const expectedCode =
            '\tINC\n' +
            '\tDEC\n';
        const actualCode = this.disTool.disassemble(binaryInput,[0,hexInput.length/2],1,'none');
        assert.strictEqual(actualCode,expectedCode);
	});
});

describe('6502 Disassembly: bitwise', async function() {
	this.beforeEach(async function() {
		const TSInitResult = await lxbase.TreeSitterInit();
		const labelSentry = new labels.LabelSentry(TSInitResult);
		this.disTool = new com.DisassemblyTool(TSInitResult,labelSentry);
	});
	it('bit', async function() {
        const hexInput = '340089003c0010';
        const binaryInput = Buffer.from(hexInput,"hex");
        const expectedCode =
            '\tBIT\t$00,X\n' +
            '\tBIT\t#$00\n' +
            '\tBIT\t$1000,X\n';
        const actualCode = this.disTool.disassemble(binaryInput,[0,hexInput.length/2],1,'none');
        assert.strictEqual(actualCode,expectedCode);
	});
	it('test bits', async function() {
        const hexInput = '040014000c00101c0010';
        const binaryInput = Buffer.from(hexInput,"hex");
        const expectedCode =
            '\tTSB\t$00\n' +
            '\tTRB\t$00\n' +
            '\tTSB\t$1000\n' +
            '\tTRB\t$1000\n';
        const actualCode = this.disTool.disassemble(binaryInput,[0,hexInput.length/2],1,'none');
        assert.strictEqual(actualCode,expectedCode);
	});
});
