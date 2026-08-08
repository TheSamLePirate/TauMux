# τ-mux shell integration — OSC 133 semantic prompt marks.
#
# Optional. τ-mux's metadata poller reads real pids through libSystem, so
# cwd, foreground command, ports, CPU and memory all work in any shell
# with zero configuration. That stays the baseline and this file never
# becomes a requirement.
#
# What the poller cannot tell you is where one command ends and the next
# begins, or what a command returned. Only the shell knows that. Sourcing
# this file makes it say so, which turns `ht blocks` into facts instead of
# inference, and gives the auto-continue engine something better than
# pattern-matching a byte stream.
#
# Marks emitted (https://gitlab.freedesktop.org/Per_Bothner/specifications):
#   OSC 133 ; A   prompt starts
#   OSC 133 ; B   prompt ends — what follows is what the user typed
#   OSC 133 ; C   command starts executing
#   OSC 133 ; D ; <exit>  command finished with this status
#
# Plus VS Code's OSC 633 ; E ; <commandline>, which states the command
# outright. Without it τ-mux has to recover the command by un-styling
# whatever your prompt framework painted over the echoed line, and a
# heavily-themed zsh makes that a guess.
#
# Safe to source twice; safe to source in a non-τ-mux terminal (other
# terminals either understand these marks or ignore them); safe under
# `set -u`. Bails out entirely when not interactive, so scp/rsync and
# other non-interactive sessions are untouched.

# Interactive check. `$-` contains `i` only in an interactive shell.
case "$-" in
  *i*) ;;
  *) return 0 2>/dev/null || exit 0 ;;
esac

# Already installed in this shell? Sourcing twice would double every mark.
if [ -n "${HT_SHELL_INTEGRATION:-}" ]; then
  return 0 2>/dev/null || exit 0
fi
HT_SHELL_INTEGRATION=1
export HT_SHELL_INTEGRATION

__ht_osc() {
  # printf rather than echo: portable escape handling, no -e/-n split
  # between bash and zsh builtins.
  printf '\033]%s\007' "$1"
}

__ht_mark_prompt_start() { __ht_osc "133;A"; }
__ht_mark_prompt_end() { __ht_osc "133;B"; }
__ht_mark_output_start() { __ht_osc "133;C"; }
__ht_mark_command_done() { __ht_osc "133;D;${1:-0}"; }
__ht_report_command() { __ht_osc "633;E;$1"; }

__ht_prompt_mark=$(printf '\033]133;B\007')

if [ -n "${ZSH_VERSION:-}" ]; then
  # ---- zsh ----------------------------------------------------------
  # precmd runs before each prompt; preexec runs after the user submits
  # a line, with the command in $1. That is exactly the shape the marks
  # want, so no PROMPT surgery is needed and a user's theme is untouched.
  __ht_preexec() {
    __ht_report_command "$1"
    __ht_mark_output_start
    __ht_command_active=1
  }

  # Prompt frameworks rebuild both the hook arrays and PS1 on every
  # prompt — Powerlevel10k and starship both do, and p10k finishes
  # loading *asynchronously*, so it can clobber us seconds after we
  # installed. Losing `preexec` that way is silent and total: prompts
  # keep being marked while every command boundary and exit code
  # disappears, which looks exactly like "the integration doesn't work".
  #
  # So re-arm on every prompt instead of trusting a one-shot install.
  # Both checks are exact-match and idempotent.
  __ht_rearm() {
    if [[ ${preexec_functions[(Ie)__ht_preexec]} -eq 0 ]]; then
      preexec_functions+=(__ht_preexec)
    fi
    case "$PS1" in
      *"$__ht_prompt_mark"*) ;;
      *) PS1="${PS1}%{${__ht_prompt_mark}%}" ;;
    esac
  }

  __ht_precmd() {
    local exit_code=$?
    if [ -n "${__ht_command_active:-}" ]; then
      __ht_mark_command_done "$exit_code"
      unset __ht_command_active
    fi
    __ht_mark_prompt_start
    __ht_rearm
  }

  # precmd_functions/preexec_functions are the additive hooks; using them
  # rather than redefining precmd() keeps other plugins working.
  autoload -Uz add-zsh-hook 2>/dev/null
  if command -v add-zsh-hook >/dev/null 2>&1; then
    add-zsh-hook precmd __ht_precmd
    add-zsh-hook preexec __ht_preexec
  else
    precmd_functions+=(__ht_precmd)
    preexec_functions+=(__ht_preexec)
  fi

  # `B` belongs at the end of the prompt, where input begins. %{...%}
  # tells zsh the bytes are zero-width, so line wrapping and right-hand
  # prompts stay correct.
  __ht_rearm

elif [ -n "${BASH_VERSION:-}" ]; then
  # ---- bash ---------------------------------------------------------
  # bash has no preexec, so the command is captured from the DEBUG trap
  # and the prompt marks ride on PROMPT_COMMAND.
  __ht_preexec_invoked=""

  __ht_debug_trap() {
    # The DEBUG trap fires for every simple command, including those
    # inside PROMPT_COMMAND. Only the first after a prompt is the user's.
    if [ -n "${COMP_LINE:-}" ]; then return; fi
    if [ "${BASH_COMMAND}" = "${PROMPT_COMMAND:-}" ]; then return; fi
    if [ -n "$__ht_preexec_invoked" ]; then return; fi
    __ht_preexec_invoked=1
    __ht_report_command "$BASH_COMMAND"
    __ht_mark_output_start
    __ht_command_active=1
  }

  # Same self-healing as the zsh path: starship and friends rebuild PS1
  # on every prompt, and a mark that only gets appended once is gone the
  # first time they do. \[ \] wrap the zero-width bytes so bash's
  # line-length accounting stays right — without them, editing a long
  # command line corrupts the display.
  __ht_rearm() {
    case "$PS1" in
      *"$__ht_prompt_mark"*) ;;
      *) PS1="${PS1}\[${__ht_prompt_mark}\]" ;;
    esac
  }

  __ht_prompt_command() {
    local exit_code=$?
    if [ -n "${__ht_command_active:-}" ]; then
      __ht_mark_command_done "$exit_code"
      __ht_command_active=""
    fi
    __ht_preexec_invoked=""
    __ht_mark_prompt_start
    __ht_rearm
  }

  __ht_rearm

  case "${PROMPT_COMMAND:-}" in
    *__ht_prompt_command*) ;;
    "") PROMPT_COMMAND="__ht_prompt_command" ;;
    *) PROMPT_COMMAND="__ht_prompt_command;${PROMPT_COMMAND}" ;;
  esac

  trap '__ht_debug_trap' DEBUG
fi
