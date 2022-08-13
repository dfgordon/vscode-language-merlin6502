* test master source file
math     ext
         ext   ONE,TWO
         use   lib
         jsr   HOME
         >>>   message
         jsr   math
         adc   #TWO
         rts
sub      lda   ($00),y
         put   put
         rts