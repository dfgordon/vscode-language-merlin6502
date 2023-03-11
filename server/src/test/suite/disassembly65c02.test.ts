import * as config from '../../settings';
import * as lxbase from '../../langExtBase';
import * as com from '../../commands';
import * as assert from 'assert';

async function testDisassembler(hexInput: string, expectedCode: string) {
    const TSInitResult = await lxbase.TreeSitterInit();
    const tool = new com.DisassemblyTool(TSInitResult, config.defaultSettings);
    const binary = Buffer.from(hexInput, "hex");
    const actualCode = tool.disassemble(Array.from(binary), {
        getWhat: 'Disassembly: Ranged',
        imgOffset: 0,
        addrRange: [0, hexInput.length / 2],
        xc: 1,
        label: 'none'
    });
    assert.deepStrictEqual(actualCode, expectedCode);
}

describe('65c02 Disassembly: octet ops', async function() {
	it('adc', async function() {
        const hexInput = '7200';
        const expectedCode =
            '         ADC   ($00)\n';
        await testDisassembler(hexInput,expectedCode);
	});
	it('and', async function() {
        const hexInput = '3200';
        const expectedCode =
            '         AND   ($00)\n';
        await testDisassembler(hexInput,expectedCode);
	});
	it('cmp', async function() {
        const hexInput = 'd200';
        const expectedCode =
            '         CMP   ($00)\n';
        await testDisassembler(hexInput,expectedCode);
	});
	it('eor', async function() {
        const hexInput = '5200';
        const expectedCode =
            '         EOR   ($00)\n';
        await testDisassembler(hexInput,expectedCode);
	});
	it('lda', async function() {
        const hexInput = 'b200';
        const expectedCode =
            '         LDA   ($00)\n';
        await testDisassembler(hexInput,expectedCode);
	});
	it('ora', async function() {
        const hexInput = '1200';
        const expectedCode =
            '         ORA   ($00)\n';
        await testDisassembler(hexInput,expectedCode);
	});
	it('sbc', async function() {
        const hexInput = 'f200';
        const expectedCode =
            '         SBC   ($00)\n';
        await testDisassembler(hexInput,expectedCode);
	});
});

describe('6502 Disassembly: store ops', async function() {
	it('sta', async function() {
        const hexInput = '9200';
        const expectedCode =
            '         STA   ($00)\n';
        await testDisassembler(hexInput,expectedCode);
	});
	it('stz', async function() {
        const hexInput = '640074009c00109e0010';
        const expectedCode =
            '         STZ   $00\n' +
            '         STZ   $00,X\n' +
            '         STZ   $1000\n' +
            '         STZ   $1000,X\n';
        await testDisassembler(hexInput,expectedCode);
	});
});

describe('6502 Disassembly: branching', async function() {
	it('branch relative', async function() {
        const hexInput = '8000';
        const expectedCode =
            '         BRA   $0002\n';
        await testDisassembler(hexInput,expectedCode);
	});
	it('jumping', async function() {
        const hexInput = '7c0010';
        const expectedCode =
            '         JMP   ($1000,X)\n';
        await testDisassembler(hexInput,expectedCode);
	});
});

describe('6502 Disassembly: short ops', async function() {
	it('stack', async function() {
        const hexInput = '5a7adafa';
        const expectedCode =
            '         PHY\n' +
            '         PLY\n' +
            '         PHX\n' +
            '         PLX\n';
        await testDisassembler(hexInput,expectedCode);
	});
	it('increment', async function() {
        const hexInput = '1a3a';
        const expectedCode =
            '         INC\n' +
            '         DEC\n';
        await testDisassembler(hexInput,expectedCode);
	});
});

describe('6502 Disassembly: bitwise', async function() {
	it('bit', async function() {
        const hexInput = '340089003c0010';
        const expectedCode =
            '         BIT   $00,X\n' +
            '         BIT   #$00\n' +
            '         BIT   $1000,X\n';
        await testDisassembler(hexInput,expectedCode);
	});
	it('test bits', async function() {
        const hexInput = '040014000c00101c0010';
        const expectedCode =
            '         TSB   $00\n' +
            '         TRB   $00\n' +
            '         TSB   $1000\n' +
            '         TRB   $1000\n';
        await testDisassembler(hexInput,expectedCode);
	});
});
