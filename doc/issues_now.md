issues and improvement : 

- ht log : i dont know what it does

# HT Status
- Parse the key and content so :
- status in sidebar : base on the content lenght of body, make it a col or a line

 - Make ht set-status shown on ui  have 2 type of status key : normal and starting with "_"
_key are not shown on the sidebar but are part of the status bar key.

if a key ends by _pct, show it as a percentage (cpu_pct) becomes cpu and the content is shown as a percentage (graph h-bar,v-bar,gauge)
Let's build a system to make status key very smart (text, longtext,pct,number,dataGraph)
for example if key is cpu_hist_lineGraph and body is 23,55,77,55,44,22,77,88 => cpu_hist : linegraph of the data
make a status key plan_array with body [["P1 : look at the code","done"],["P2 : Edit the code","active"],["P3 : Commit","waiting"]] that will show the plan multiline
- On layout setting for the status bar key, allow the user to input its own key on the system (order, arrance, activate/desactivate)



# Notification : 
- Also show the notification content as an overlay on top of the terminal that send that notification
- Auto accept when claude code request permission (Enter on the terminal)
- Remove Claude Code waiting for your input (from claude hooks)


# Sideband view :
- It must allways be visible on top of the terminal even if the terminal is not focused, now sometimes, it is transparent when not focused

# sharedBin
- Make all the utilities needed (img, md, json,webcam,diff, gitlog,...) AAA quality all in mjs or ts. no python

# Sidebar Workspace card: 
- flicker on refresh...
- Add settings for what is shown and how, modular

# Ht issue : 

echo $HT_SOCKET_PATH

but :
ht identify{  "focused_surface": "surface:2",  "active_workspace": "ws:6",  "socket_path": "/tmp/hyperterm.sock"}  it is hardcoded in system.ts
/tmp/hypterterm.sock is present everywhere but i think it is never used anymore (maybe in tests?)

for ht to work on any terminal, just export the right socket : 
/Users/olivierveinand/Library/Application Support/hyperterm-canvas/hyperterm.sock
i did it in .zshrc


# When telegram crash, notification dont work and ht dont work anymore
and ht dont work (socket down?)

#add a audit that check if my name is in git olivierveinand (it is !!!)

issue with line height (i think) on sidebar resize



# Telegram smarter : 
On turn end notification, add buttons to the telegram message :
OK, continue / Commit (that will be sent to the surface + Enter)

# Plan handled by t-mux
agent sent the plan to t-mux (plan panel)
on turn end, a small fast model - or an automation Say, based on plan update : Ok, continue M3, or OK, continue if the plan is not finished
If it is a small fast model, it can maybe be more granular

# User Request handled in t-mux
when a agent ask user question, it does it in tmux

# OSC 9;4 progress reporting 
if a program send OSC, t-mux must accept them (make the list os OSC)


# Issue with scrolling.
Sometimes (more on pi than on claude)
the terminal scroll to the top... Very boring




# http mirror ui
Let's make it on par with only bridge view.
Can go fullscreen and resize
but add mobile/touch UI/UX

#where is the log file?? i never remember




