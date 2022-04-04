        ORG     $300
COUT    EQU     $FDED   ; Apple ROM routine
        DO      0
init    MAC             ; macro definition
        LDY     ]1
        <<<
        FIN
        init    #$00
:loop   LDA     hello,Y
        JSR     COUT
        INY
        CPY     #$0E
        BNE     :loop
        RTS
hello   ASC     &"Hello World!"& ; dstring
