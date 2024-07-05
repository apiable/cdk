#!/usr/bin/env bash

checkMandatoryParameter () {
  if [ -z "$1" ] && [ -z "$2" ]
    then
      if [ "-" == "$3" ]
        then
          echo "$4"
          echo "Example: $EXAMPLE"
          exit 1
        else
          return 0
      fi
  fi

  [[ -n "$1" ]] && return 0
  [[ -n "$2" ]] && return 1 # return 1 == error, so the env variable will be taken which is passed with $2
}