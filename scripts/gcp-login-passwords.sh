#!/bin/sh

echo "Enter chester password:" && read -s CHESTER_PW && echo && \
echo "Enter guest password:" && read -s GUEST_PW && echo && \
echo -n "$CHESTER_PW" | gcloud secrets create AUTH_PASSWORD_CHESTER --data-file=- 2>/dev/null || \
echo -n "$CHESTER_PW" | gcloud secrets versions add AUTH_PASSWORD_CHESTER --data-file=- && \
echo -n "$GUEST_PW" | gcloud secrets create AUTH_PASSWORD_GUEST --data-file=- 2>/dev/null || \
echo -n "$GUEST_PW" | gcloud secrets versions add AUTH_PASSWORD_GUEST --data-file=-
