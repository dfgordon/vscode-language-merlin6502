* test master source file
math     ext
hello    MAC
         INX
         DFB   math
         DFB   sub
         jmp   cont
         DO    cont/2
         LUP   sub/2
         INC
         --^
         INC   cont
         FIN
         FIN
cont     INY
         <<<
         ext   ONE,TWO
         use   lib
         jsr   HOME
         >>>   message,"M";"e";"r"
         jsr   math
         adc   #TWO
         rts
sub      lda   ($00),y
         put   put
         rts