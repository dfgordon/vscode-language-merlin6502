* test macro library
COUT     =     $fded
HOME     =     $fc58
go       mac
         INC   ]1
         INY
         eom
message  mac
         pmc   go,]2
         ASC   ']2'
         lda   #]1
         jsr   COUT
         lda   #]2
         jsr   COUT
         lda   #]3
         jsr   COUT
         lda   #"l"
         jsr   COUT
         lda   #"i"
         jsr   COUT
         lda   #"n"
         jsr   COUT
         ASC   ']1'
         eom
err      put   somefile
