* test macro library
COUT     =     $fded
HOME     =     $fc58
message  mac
         lda   #"M"
         jsr   COUT
         lda   #"e"
         jsr   COUT
         lda   #"r"
         jsr   COUT
         lda   #"l"
         jsr   COUT
         lda   #"i"
         jsr   COUT
         lda   #"n"
         jsr   COUT
         eom
err      put   somefile
