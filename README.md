# Ludo Master Admin Panel v2

Admin Panel + updated Render backend.

## Features
- Admin login
- Dashboard statistics
- User search and block/unblock
- Gaming/Winning balance adjustment
- Deposit approve/reject
- Withdraw approve/reject with refund on rejection
- Match create/edit/delete
- Room ID and match status
- Winning approve/reject with prize credit
- Winning screenshot link
- Support inbox and replies
- Announcement create/enable/disable/delete
- Green action buttons throughout the admin panel

## Render
Build: `npm install`
Start: `npm start`

Environment variables:
- JWT_SECRET
- ADMIN_MOBILE
- ADMIN_PASSWORD

Admin URL:
`https://YOUR-RENDER-DOMAIN/admin`

This version uses JSON storage. For a real-money production service, use a persistent database, proper payment verification, audit logs, access controls, rate limits, backups, and applicable legal/payment compliance.
