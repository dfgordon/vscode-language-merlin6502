import * as config from '../../settings';
import * as lxbase from '../../langExtBase';
import * as com from '../../commands';
import * as assert from 'assert';

async function testDisassembler(hexInput: string, expectedCode: string) {
    const TSInitResult = await lxbase.TreeSitterInit();
    const tool = new com.DisassemblyTool(TSInitResult, console, config.defaultSettings);
    const binary = Buffer.from(hexInput, "hex");
    const actualCode = tool.disassemble(Array.from(binary), {
        getWhat: 'Disassembly: Ranged',
        imgOffset: 0,
        addrRange: [0, hexInput.length / 2],
        xc: 0,
        label: 'none'
    });
    assert.deepStrictEqual(actualCode, expectedCode);
}

describe('6502 Disassembly: octet ops', async function () {
    
    it('adc', async function () {
        const hexInput = '6900650075006d00107d001079001061007100';
        const expectedCode =
            '         ADC   #$00\n' +
            '         ADC   $00\n' +
            '         ADC   $00,X\n' +
            '         ADC   $1000\n' +
            '         ADC   $1000,X\n' +
            '         ADC   $1000,Y\n' +
            '         ADC   ($00,X)\n' +
            '         ADC   ($00),Y\n';
        await testDisassembler(hexInput, expectedCode);
    });
    it('and', async function () {
        const hexInput = '2900250035002d00103d001039001021003100';
        const expectedCode =
            '         AND   #$00\n' +
            '         AND   $00\n' +
            '         AND   $00,X\n' +
            '         AND   $1000\n' +
            '         AND   $1000,X\n' +
            '         AND   $1000,Y\n' +
            '         AND   ($00,X)\n' +
            '         AND   ($00),Y\n';
        await testDisassembler(hexInput, expectedCode);
    });
    it('cmp', async function () {
        const hexInput = 'c900c500d500cd0010dd0010d90010c100d100';
        const expectedCode =
            '         CMP   #$00\n' +
            '         CMP   $00\n' +
            '         CMP   $00,X\n' +
            '         CMP   $1000\n' +
            '         CMP   $1000,X\n' +
            '         CMP   $1000,Y\n' +
            '         CMP   ($00,X)\n' +
            '         CMP   ($00),Y\n';
        await testDisassembler(hexInput, expectedCode);
    });
    it('eor', async function () {
        const hexInput = '4900450055004d00105d001059001041005100';
        const expectedCode =
            '         EOR   #$00\n' +
            '         EOR   $00\n' +
            '         EOR   $00,X\n' +
            '         EOR   $1000\n' +
            '         EOR   $1000,X\n' +
            '         EOR   $1000,Y\n' +
            '         EOR   ($00,X)\n' +
            '         EOR   ($00),Y\n';
        await testDisassembler(hexInput, expectedCode);
    });
    it('lda', async function () {
        const hexInput = 'a900a500b500ad0010bd0010b90010a100b100';
        const expectedCode =
            '         LDA   #$00\n' +
            '         LDA   $00\n' +
            '         LDA   $00,X\n' +
            '         LDA   $1000\n' +
            '         LDA   $1000,X\n' +
            '         LDA   $1000,Y\n' +
            '         LDA   ($00,X)\n' +
            '         LDA   ($00),Y\n';
        await testDisassembler(hexInput, expectedCode);
    });
    it('ora', async function () {
        const hexInput = '0900050015000d00101d001019001001001100';
        const expectedCode =
            '         ORA   #$00\n' +
            '         ORA   $00\n' +
            '         ORA   $00,X\n' +
            '         ORA   $1000\n' +
            '         ORA   $1000,X\n' +
            '         ORA   $1000,Y\n' +
            '         ORA   ($00,X)\n' +
            '         ORA   ($00),Y\n';
        await testDisassembler(hexInput, expectedCode);
    });
    it('sbc', async function () {
        const hexInput = 'e900e500f500ed0010fd0010f90010e100f100';
        const expectedCode =
            '         SBC   #$00\n' +
            '         SBC   $00\n' +
            '         SBC   $00,X\n' +
            '         SBC   $1000\n' +
            '         SBC   $1000,X\n' +
            '         SBC   $1000,Y\n' +
            '         SBC   ($00,X)\n' +
            '         SBC   ($00),Y\n';
        await testDisassembler(hexInput, expectedCode);
    });
});

describe('6502 Disassembly: store ops', async function () {
    
    it('sta', async function () {
        const hexInput = '850095008d00109d001099001081009100';
        const expectedCode =
            '         STA   $00\n' +
            '         STA   $00,X\n' +
            '         STA   $1000\n' +
            '         STA   $1000,X\n' +
            '         STA   $1000,Y\n' +
            '         STA   ($00,X)\n' +
            '         STA   ($00),Y\n';
        await testDisassembler(hexInput, expectedCode);
    });
    it('stx', async function () {
        const hexInput = '860096008e0010';
        const expectedCode =
            '         STX   $00\n' +
            '         STX   $00,Y\n' +
            '         STX   $1000\n';
        await testDisassembler(hexInput, expectedCode);
    });
    it('sty', async function () {
        const hexInput = '840094008c0010';
        const expectedCode =
            '         STY   $00\n' +
            '         STY   $00,X\n' +
            '         STY   $1000\n';
        await testDisassembler(hexInput, expectedCode);
    });
});

describe('6502 Disassembly: index ops', async function () {
    
    it('cpx', async function () {
        const hexInput = 'e000e400ec0010';
        const expectedCode =
            '         CPX   #$00\n' +
            '         CPX   $00\n' +
            '         CPX   $1000\n';
        await testDisassembler(hexInput, expectedCode);
    });
    it('cpy', async function () {
        const hexInput = 'c000c400cc0010';
        const expectedCode =
            '         CPY   #$00\n' +
            '         CPY   $00\n' +
            '         CPY   $1000\n';
        await testDisassembler(hexInput, expectedCode);
    });
    it('ldx', async function () {
        const hexInput = 'a200a600b600ae0010be0010';
        const expectedCode =
            '         LDX   #$00\n' +
            '         LDX   $00\n' +
            '         LDX   $00,Y\n' +
            '         LDX   $1000\n' +
            '         LDX   $1000,Y\n';
        await testDisassembler(hexInput, expectedCode);
    });
    it('ldy', async function () {
        const hexInput = 'a000a400b400ac0010bc0010';
        const expectedCode =
            '         LDY   #$00\n' +
            '         LDY   $00\n' +
            '         LDY   $00,X\n' +
            '         LDY   $1000\n' +
            '         LDY   $1000,X\n';
        await testDisassembler(hexInput, expectedCode);
    });
});

describe('6502 Disassembly: branching', async function () {
    
    it('forward branch', async function () {
        const hexInput = '907fb010f0003000d000100050007000';
        const expectedCode =
            '         BCC   $0081\n' +
            '         BCS   $0014\n' +
            '         BEQ   $0006\n' +
            '         BMI   $0008\n' +
            '         BNE   $000A\n' +
            '         BPL   $000C\n' +
            '         BVC   $000E\n' +
            '         BVS   $0010\n';
        await testDisassembler(hexInput, expectedCode);
    });
    it('reverse branch', async function () {
        const hexInput = '9000b0fcf0fc30fcd0fc10fc50fc70fc';
        const expectedCode =
            '         BCC   $0002\n' +
            '         BCS   $0000\n' +
            '         BEQ   $0002\n' +
            '         BMI   $0004\n' +
            '         BNE   $0006\n' +
            '         BPL   $0008\n' +
            '         BVC   $000A\n' +
            '         BVS   $000C\n';
        await testDisassembler(hexInput, expectedCode);
    });
    it('jumping', async function () {
        const hexInput = '4c00106c00102000104060';
        const expectedCode =
            '         JMP   $1000\n' +
            '         JMP   ($1000)\n' +
            '         JSR   $1000\n' +
            '         RTI\n' +
            '         RTS\n';
        await testDisassembler(hexInput, expectedCode);
    });
});

describe('6502 Disassembly: short ops', async function () {
    
    it('status', async function () {
        const hexInput = '18d858b838f878';
        const expectedCode =
            '         CLC\n' +
            '         CLD\n' +
            '         CLI\n' +
            '         CLV\n' +
            '         SEC\n' +
            '         SED\n' +
            '         SEI\n';
        await testDisassembler(hexInput, expectedCode);
    });
    it('stack', async function () {
        const hexInput = '48086828';
        const expectedCode =
            '         PHA\n' +
            '         PHP\n' +
            '         PLA\n' +
            '         PLP\n';
        await testDisassembler(hexInput, expectedCode);
    });
    it('transfer', async function () {
        const hexInput = 'aaa8ba8a9a98';
        const expectedCode =
            '         TAX\n' +
            '         TAY\n' +
            '         TSX\n' +
            '         TXA\n' +
            '         TXS\n' +
            '         TYA\n';
        await testDisassembler(hexInput, expectedCode);
    });
    it('increment', async function () {
        const hexInput = 'ca88e600f600ee0010fe0010e8c8';
        const expectedCode =
            '         DEX\n' +
            '         DEY\n' +
            '         INC   $00\n' +
            '         INC   $00,X\n' +
            '         INC   $1000\n' +
            '         INC   $1000,X\n' +
            '         INX\n' +
            '         INY\n';
        await testDisassembler(hexInput, expectedCode);
    });
    it('other', async function () {
        const brk = config.defaultSettings.disassembly.brk;
        const hexInput = '0000EA';
        if (brk) {
            const expectedCode =
                '         BRK   #$00\n' +
                '         NOP\n';
            await testDisassembler(hexInput, expectedCode);
        }
        else if (brk == false) {
            const expectedCode =
                '         DFB   $00\n' +
                '         DFB   $00\n' +
                '         NOP\n';
            await testDisassembler(hexInput, expectedCode);
        }
        else {
            assert.fail('could not get configuration');
        }
    });
});

describe('6502 Disassembly: bitwise', async function () {
    
    it('asl', async function () {
        const hexInput = '0a060016000e00101e0010';
        const expectedCode =
            '         ASL\n' +
            '         ASL   $00\n' +
            '         ASL   $00,X\n' +
            '         ASL   $1000\n' +
            '         ASL   $1000,X\n';
        await testDisassembler(hexInput, expectedCode);
    });
    it('bit', async function () {
        const hexInput = '24002c0010';
        const expectedCode =
            '         BIT   $00\n' +
            '         BIT   $1000\n';
        await testDisassembler(hexInput, expectedCode);
    });
    it('lsr', async function () {
        const hexInput = '4a460056004e00105e0010';
        const expectedCode =
            '         LSR\n' +
            '         LSR   $00\n' +
            '         LSR   $00,X\n' +
            '         LSR   $1000\n' +
            '         LSR   $1000,X\n';
        await testDisassembler(hexInput, expectedCode);
    });
    it('rol', async function () {
        const hexInput = '2a260036002e00103e0010';
        const expectedCode =
            '         ROL\n' +
            '         ROL   $00\n' +
            '         ROL   $00,X\n' +
            '         ROL   $1000\n' +
            '         ROL   $1000,X\n';
        await testDisassembler(hexInput, expectedCode);
    });
    it('ror', async function () {
        const hexInput = '6a660076006e00107e0010';
        const expectedCode =
            '         ROR\n' +
            '         ROR   $00\n' +
            '         ROR   $00,X\n' +
            '         ROR   $1000\n' +
            '         ROR   $1000,X\n';
        await testDisassembler(hexInput, expectedCode);
    });
});
