import * as vscode from 'vscode';
import * as lxbase from '../../langExtBase';
import * as labels from '../../labels';
import * as com from '../../commands';
import * as assert from 'assert';

describe('6502 Disassembly: octet ops', async function() {
	this.beforeEach(async function() {
		const TSInitResult = await lxbase.TreeSitterInit();
		const labelSentry = new labels.LabelSentry(TSInitResult);
		this.disTool = new com.DisassemblyTool(TSInitResult,labelSentry);
	});
	it('adc', async function() {
        const hexInput = '6900650075006d00107d001079001061007100';
        const binaryInput = Buffer.from(hexInput,"hex");
        const expectedCode =
            '\tADC\t#$00\n' + 
            '\tADC\t$00\n' +
            '\tADC\t$00,X\n' +
            '\tADC\t$1000\n' +
            '\tADC\t$1000,X\n' +
            '\tADC\t$1000,Y\n' +
            '\tADC\t($00,X)\n' +
            '\tADC\t($00),Y\n';
        const actualCode = this.disTool.disassemble(binaryInput,[0,hexInput.length/2],0,'none');
        assert.strictEqual(actualCode,expectedCode);
	});
	it('and', async function() {
        const hexInput = '2900250035002d00103d001039001021003100';
        const binaryInput = Buffer.from(hexInput,"hex");
        const expectedCode =
            '\tAND\t#$00\n' + 
            '\tAND\t$00\n' +
            '\tAND\t$00,X\n' +
            '\tAND\t$1000\n' +
            '\tAND\t$1000,X\n' +
            '\tAND\t$1000,Y\n' +
            '\tAND\t($00,X)\n' +
            '\tAND\t($00),Y\n';
        const actualCode = this.disTool.disassemble(binaryInput,[0,hexInput.length/2],0,'none');
        assert.strictEqual(actualCode,expectedCode);
	});
	it('cmp', async function() {
        const hexInput = 'c900c500d500cd0010dd0010d90010c100d100';
        const binaryInput = Buffer.from(hexInput,"hex");
        const expectedCode =
            '\tCMP\t#$00\n' + 
            '\tCMP\t$00\n' +
            '\tCMP\t$00,X\n' +
            '\tCMP\t$1000\n' +
            '\tCMP\t$1000,X\n' +
            '\tCMP\t$1000,Y\n' +
            '\tCMP\t($00,X)\n' +
            '\tCMP\t($00),Y\n';
        const actualCode = this.disTool.disassemble(binaryInput,[0,hexInput.length/2],0,'none');
        assert.strictEqual(actualCode,expectedCode);
	});
	it('eor', async function() {
        const hexInput = '4900450055004d00105d001059001041005100';
        const binaryInput = Buffer.from(hexInput,"hex");
        const expectedCode =
            '\tEOR\t#$00\n' + 
            '\tEOR\t$00\n' +
            '\tEOR\t$00,X\n' +
            '\tEOR\t$1000\n' +
            '\tEOR\t$1000,X\n' +
            '\tEOR\t$1000,Y\n' +
            '\tEOR\t($00,X)\n' +
            '\tEOR\t($00),Y\n';
        const actualCode = this.disTool.disassemble(binaryInput,[0,hexInput.length/2],0,'none');
        assert.strictEqual(actualCode,expectedCode);
	});
	it('lda', async function() {
        const hexInput = 'a900a500b500ad0010bd0010b90010a100b100';
        const binaryInput = Buffer.from(hexInput,"hex");
        const expectedCode =
            '\tLDA\t#$00\n' + 
            '\tLDA\t$00\n' +
            '\tLDA\t$00,X\n' +
            '\tLDA\t$1000\n' +
            '\tLDA\t$1000,X\n' +
            '\tLDA\t$1000,Y\n' +
            '\tLDA\t($00,X)\n' +
            '\tLDA\t($00),Y\n';
        const actualCode = this.disTool.disassemble(binaryInput,[0,hexInput.length/2],0,'none');
        assert.strictEqual(actualCode,expectedCode);
	});
	it('ora', async function() {
        const hexInput = '0900050015000d00101d001019001001001100';
        const binaryInput = Buffer.from(hexInput,"hex");
        const expectedCode =
            '\tORA\t#$00\n' + 
            '\tORA\t$00\n' +
            '\tORA\t$00,X\n' +
            '\tORA\t$1000\n' +
            '\tORA\t$1000,X\n' +
            '\tORA\t$1000,Y\n' +
            '\tORA\t($00,X)\n' +
            '\tORA\t($00),Y\n';
        const actualCode = this.disTool.disassemble(binaryInput,[0,hexInput.length/2],0,'none');
        assert.strictEqual(actualCode,expectedCode);
	});
	it('sbc', async function() {
        const hexInput = 'e900e500f500ed0010fd0010f90010e100f100';
        const binaryInput = Buffer.from(hexInput,"hex");
        const expectedCode =
            '\tSBC\t#$00\n' + 
            '\tSBC\t$00\n' +
            '\tSBC\t$00,X\n' +
            '\tSBC\t$1000\n' +
            '\tSBC\t$1000,X\n' +
            '\tSBC\t$1000,Y\n' +
            '\tSBC\t($00,X)\n' +
            '\tSBC\t($00),Y\n';
        const actualCode = this.disTool.disassemble(binaryInput,[0,hexInput.length/2],0,'none');
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
        const hexInput = '850095008d00109d001099001081009100';
        const binaryInput = Buffer.from(hexInput,"hex");
        const expectedCode =
            '\tSTA\t$00\n' +
            '\tSTA\t$00,X\n' +
            '\tSTA\t$1000\n' +
            '\tSTA\t$1000,X\n' +
            '\tSTA\t$1000,Y\n' +
            '\tSTA\t($00,X)\n' +
            '\tSTA\t($00),Y\n';
        const actualCode = this.disTool.disassemble(binaryInput,[0,hexInput.length/2],0,'none');
        assert.strictEqual(actualCode,expectedCode);
	});
	it('stx', async function() {
        const hexInput = '860096008e0010';
        const binaryInput = Buffer.from(hexInput,"hex");
        const expectedCode =
            '\tSTX\t$00\n' +
            '\tSTX\t$00,Y\n' +
            '\tSTX\t$1000\n';
        const actualCode = this.disTool.disassemble(binaryInput,[0,hexInput.length/2],0,'none');
        assert.strictEqual(actualCode,expectedCode);
	});
	it('sty', async function() {
        const hexInput = '840094008c0010';
        const binaryInput = Buffer.from(hexInput,"hex");
        const expectedCode =
            '\tSTY\t$00\n' +
            '\tSTY\t$00,X\n' +
            '\tSTY\t$1000\n';
        const actualCode = this.disTool.disassemble(binaryInput,[0,hexInput.length/2],0,'none');
        assert.strictEqual(actualCode,expectedCode);
	});
});

describe('6502 Disassembly: index ops', async function() {
	this.beforeEach(async function() {
		const TSInitResult = await lxbase.TreeSitterInit();
		const labelSentry = new labels.LabelSentry(TSInitResult);
		this.disTool = new com.DisassemblyTool(TSInitResult,labelSentry);
	});
	it('cpx', async function() {
        const hexInput = 'e000e400ec0010';
        const binaryInput = Buffer.from(hexInput,"hex");
        const expectedCode =
            '\tCPX\t#$00\n' +
            '\tCPX\t$00\n' +
            '\tCPX\t$1000\n';
        const actualCode = this.disTool.disassemble(binaryInput,[0,hexInput.length/2],0,'none');
        assert.strictEqual(actualCode,expectedCode);
	});
	it('cpy', async function() {
        const hexInput = 'c000c400cc0010';
        const binaryInput = Buffer.from(hexInput,"hex");
        const expectedCode =
            '\tCPY\t#$00\n' +
            '\tCPY\t$00\n' +
            '\tCPY\t$1000\n';
        const actualCode = this.disTool.disassemble(binaryInput,[0,hexInput.length/2],0,'none');
        assert.strictEqual(actualCode,expectedCode);
	});
	it('ldx', async function() {
        const hexInput = 'a200a600b600ae0010be0010';
        const binaryInput = Buffer.from(hexInput,"hex");
        const expectedCode =
            '\tLDX\t#$00\n' +
            '\tLDX\t$00\n' +
            '\tLDX\t$00,Y\n' +
            '\tLDX\t$1000\n' +
            '\tLDX\t$1000,Y\n';
        const actualCode = this.disTool.disassemble(binaryInput,[0,hexInput.length/2],0,'none');
        assert.strictEqual(actualCode,expectedCode);
	});
	it('ldy', async function() {
        const hexInput = 'a000a400b400ac0010bc0010';
        const binaryInput = Buffer.from(hexInput,"hex");
        const expectedCode =
            '\tLDY\t#$00\n' +
            '\tLDY\t$00\n' +
            '\tLDY\t$00,X\n' +
            '\tLDY\t$1000\n' +
            '\tLDY\t$1000,X\n';
        const actualCode = this.disTool.disassemble(binaryInput,[0,hexInput.length/2],0,'none');
        assert.strictEqual(actualCode,expectedCode);
	});
});

describe('6502 Disassembly: branching', async function() {
	this.beforeEach(async function() {
		const TSInitResult = await lxbase.TreeSitterInit();
		const labelSentry = new labels.LabelSentry(TSInitResult);
		this.disTool = new com.DisassemblyTool(TSInitResult,labelSentry);
	});
	it('forward branch', async function() {
        const hexInput = '907fb010f0003000d000100050007000';
        const binaryInput = Buffer.from(hexInput,"hex");
        const expectedCode =
            '\tBCC\t$0081\n' +
            '\tBCS\t$0014\n' +
            '\tBEQ\t$0006\n' +
            '\tBMI\t$0008\n' +
            '\tBNE\t$000A\n' +
            '\tBPL\t$000C\n' +
            '\tBVC\t$000E\n' +
            '\tBVS\t$0010\n';
        const actualCode = this.disTool.disassemble(binaryInput,[0,hexInput.length/2],0,'none');
        assert.strictEqual(actualCode,expectedCode);
	});
	it('reverse branch', async function() {
        const hexInput = '9000b0fcf0fc30fcd0fc10fc50fc70fc';
        const binaryInput = Buffer.from(hexInput,"hex");
        const expectedCode =
            '\tBCC\t$0002\n' +
            '\tBCS\t$0000\n' +
            '\tBEQ\t$0002\n' +
            '\tBMI\t$0004\n' +
            '\tBNE\t$0006\n' +
            '\tBPL\t$0008\n' +
            '\tBVC\t$000A\n' +
            '\tBVS\t$000C\n';
        const actualCode = this.disTool.disassemble(binaryInput,[0,hexInput.length/2],0,'none');
        assert.strictEqual(actualCode,expectedCode);
	});
	it('jumping', async function() {
        const hexInput = '4c00106c00102000104060';
        const binaryInput = Buffer.from(hexInput,"hex");
        const expectedCode =
            '\tJMP\t$1000\n' +
            '\tJMP\t($1000)\n' +
            '\tJSR\t$1000\n' +
            '\tRTI\n' +
            '\tRTS\n';
        const actualCode = this.disTool.disassemble(binaryInput,[0,hexInput.length/2],0,'none');
        assert.strictEqual(actualCode,expectedCode);
	});
});

describe('6502 Disassembly: short ops', async function() {
	this.beforeEach(async function() {
		const TSInitResult = await lxbase.TreeSitterInit();
		const labelSentry = new labels.LabelSentry(TSInitResult);
		this.disTool = new com.DisassemblyTool(TSInitResult,labelSentry);
	});
	it('status', async function() {
        const hexInput = '18d858b838f878';
        const binaryInput = Buffer.from(hexInput,"hex");
        const expectedCode =
            '\tCLC\n' +
            '\tCLD\n' +
            '\tCLI\n' +
            '\tCLV\n' +
            '\tSEC\n' +
            '\tSED\n' +
            '\tSEI\n';
        const actualCode = this.disTool.disassemble(binaryInput,[0,hexInput.length/2],0,'none');
        assert.strictEqual(actualCode,expectedCode);
	});
	it('stack', async function() {
        const hexInput = '48086828';
        const binaryInput = Buffer.from(hexInput,"hex");
        const expectedCode =
            '\tPHA\n' +
            '\tPHP\n' +
            '\tPLA\n' +
            '\tPLP\n';
        const actualCode = this.disTool.disassemble(binaryInput,[0,hexInput.length/2],0,'none');
        assert.strictEqual(actualCode,expectedCode);
	});
	it('transfer', async function() {
        const hexInput = 'aaa8ba8a9a98';
        const binaryInput = Buffer.from(hexInput,"hex");
        const expectedCode =
            '\tTAX\n' +
            '\tTAY\n' +
            '\tTSX\n' +
            '\tTXA\n' +
            '\tTXS\n' +
            '\tTYA\n';
        const actualCode = this.disTool.disassemble(binaryInput,[0,hexInput.length/2],0,'none');
        assert.strictEqual(actualCode,expectedCode);
	});
	it('increment', async function() {
        const hexInput = 'ca88e600f600ee0010fe0010e8c8';
        const binaryInput = Buffer.from(hexInput,"hex");
        const expectedCode =
            '\tDEX\n' +
            '\tDEY\n' +
            '\tINC\t$00\n' +
            '\tINC\t$00,X\n' +
            '\tINC\t$1000\n' +
            '\tINC\t$1000,X\n' +
            '\tINX\n' +
            '\tINY\n';
        const actualCode = this.disTool.disassemble(binaryInput,[0,hexInput.length/2],0,'none');
        assert.strictEqual(actualCode,expectedCode);
	});
	it('other', async function() {
        const hexInput = '0000EA';
        const binaryInput = Buffer.from(hexInput,"hex");
        const expectedCode =
            '\tBRK\t#$00\n' +
            '\tNOP\n';
        const actualCode = this.disTool.disassemble(binaryInput,[0,hexInput.length/2],0,'none');
        assert.strictEqual(actualCode,expectedCode);
	});
});

describe('6502 Disassembly: bitwise', async function() {
	this.beforeEach(async function() {
		const TSInitResult = await lxbase.TreeSitterInit();
		const labelSentry = new labels.LabelSentry(TSInitResult);
		this.disTool = new com.DisassemblyTool(TSInitResult,labelSentry);
	});
	it('asl', async function() {
        const hexInput = '0a060016000e00101e0010';
        const binaryInput = Buffer.from(hexInput,"hex");
        const expectedCode =
            '\tASL\n' +
            '\tASL\t$00\n' +
            '\tASL\t$00,X\n' +
            '\tASL\t$1000\n' +
            '\tASL\t$1000,X\n';
        const actualCode = this.disTool.disassemble(binaryInput,[0,hexInput.length/2],0,'none');
        assert.strictEqual(actualCode,expectedCode);
	});
	it('bit', async function() {
        const hexInput = '24002c0010';
        const binaryInput = Buffer.from(hexInput,"hex");
        const expectedCode =
            '\tBIT\t$00\n' +
            '\tBIT\t$1000\n';
        const actualCode = this.disTool.disassemble(binaryInput,[0,hexInput.length/2],0,'none');
        assert.strictEqual(actualCode,expectedCode);
	});
	it('lsr', async function() {
        const hexInput = '4a460056004e00105e0010';
        const binaryInput = Buffer.from(hexInput,"hex");
        const expectedCode =
            '\tLSR\n' +
            '\tLSR\t$00\n' +
            '\tLSR\t$00,X\n' +
            '\tLSR\t$1000\n' +
            '\tLSR\t$1000,X\n';
        const actualCode = this.disTool.disassemble(binaryInput,[0,hexInput.length/2],0,'none');
        assert.strictEqual(actualCode,expectedCode);
	});
	it('rol', async function() {
        const hexInput = '2a260036002e00103e0010';
        const binaryInput = Buffer.from(hexInput,"hex");
        const expectedCode =
            '\tROL\n' +
            '\tROL\t$00\n' +
            '\tROL\t$00,X\n' +
            '\tROL\t$1000\n' +
            '\tROL\t$1000,X\n';
        const actualCode = this.disTool.disassemble(binaryInput,[0,hexInput.length/2],0,'none');
        assert.strictEqual(actualCode,expectedCode);
	});
	it('ror', async function() {
        const hexInput = '6a660076006e00107e0010';
        const binaryInput = Buffer.from(hexInput,"hex");
        const expectedCode =
            '\tROR\n' +
            '\tROR\t$00\n' +
            '\tROR\t$00,X\n' +
            '\tROR\t$1000\n' +
            '\tROR\t$1000,X\n';
        const actualCode = this.disTool.disassemble(binaryInput,[0,hexInput.length/2],0,'none');
        assert.strictEqual(actualCode,expectedCode);
	});
});
