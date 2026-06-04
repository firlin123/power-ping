#!/bin/sh
. /root/.cron-env.sh

UPTIME=$(cut -d' ' -f1 /proc/uptime)
PAYLOAD="{\"secret\":\"$SECRET_KEY\",\"uptime\":$UPTIME}"

RESULT=$(wget --quiet --post-data="$PAYLOAD" "$SERVER_URL" -O-)

if [ $? -eq 0 ]; then
  echo "Ping sent successfully: $RESULT"
else
  echo "Failed to send ping: $RESULT"
fi
