#!/bin/sh
. /root/.cron-env.sh

UPTIME=$(cut -d' ' -f1 /proc/uptime)
PARAMS='secret='"$SECRET_KEY"'&uptime='"$UPTIME"

RESULT=$(wget --quiet "$SERVER_URL/api/ping?$PARAMS" -O-)

if [ $? -eq 0 ]; then
  echo "Ping sent successfully: $RESULT"
else
  echo "Failed to send ping: $RESULT"
fi
