on run argv
	
	if (count of argv) is not 2 then
		error "wrong number of arguments" number 9000
	end if
	
	set action to item 1 of argv
	set scratchPathArg to item 2 of argv
	set pause to 0.5
	
	if {"get"} does not contain action then
		error "action argument has unknown value " & action number 9001
	end if
	
	tell application "Virtual ]["
		activate
		if (count of machine) is 0 then
			error "front machine requested, but there isn't one" number 9005
		end if
		set theMachine to front machine
		delay pause
	end tell
	
	set scratchPath to POSIX path of scratchPathArg
	tell application "Virtual ]["
		dump memory theMachine address 0 into scratchPath length 65536
	end tell
	
end run