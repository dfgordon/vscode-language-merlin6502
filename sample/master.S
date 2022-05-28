* test master source file
math     ext
         ext   ONE,TWO
         use   lib
         jsr   HOME
         >>>   message
         jsr   math
         adc   #TWO
         rts