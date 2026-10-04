/**
 * Envoy invite mailer: a Google Apps Script web app that emails workspace invites from your Gmail (free, ~100/day).
 * Setup: script.google.com → New project → paste this → Project Settings → Script properties:
 *   FIREBASE_API_KEY = your Firebase web API key (verifies the sender is a signed-in Envoy user)
 *   FIREBASE_PROJECT = your Firebase project id (checks the invite code is real and owned by the sender)
 *   APP_ORIGIN       = your site, e.g. https://envoy.vercel.app (invite links must point here)
 * Deploy → New deployment → Web app → Execute as: Me · Who has access: Anyone → copy the /exec URL
 * into NEXT_PUBLIC_MAIL_URL (Vercel env + frontend/.env.local).
 */
function doPost(e) {
  try {
    var req = JSON.parse(e.postData.contents);
    var props = PropertiesService.getScriptProperties();
    var key = props.getProperty('FIREBASE_API_KEY'), origin = props.getProperty('APP_ORIGIN');
    var who = JSON.parse(UrlFetchApp.fetch('https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=' + key, {
      method: 'post', contentType: 'application/json', payload: JSON.stringify({ idToken: req.idToken }), muteHttpExceptions: true,
    }).getContentText());
    var user = who.users && who.users[0];
    if (!user) return out({ ok: false, error: 'Please sign in again' });
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(req.to || '')) return out({ ok: false, error: 'Invalid email address' });
    if (!/^[A-Z0-9]{5}-[A-Z0-9]{5}$/.test(req.code || '') || req.link !== origin + '/?join=' + req.code) return out({ ok: false, error: 'Bad invite' });
    // The code must exist and belong to the sender, so the mailer can't be used to send arbitrary invites.
    var code = UrlFetchApp.fetch('https://firestore.googleapis.com/v1/projects/' + props.getProperty('FIREBASE_PROJECT') + '/databases/(default)/documents/codes/' + req.code,
      { headers: { Authorization: 'Bearer ' + req.idToken }, muteHttpExceptions: true });
    var owner = code.getResponseCode() === 200 && JSON.parse(code.getContentText()).fields.owner;
    if (!owner || owner.stringValue !== user.localId) return out({ ok: false, error: 'Only the workspace owner can email invites' });
    // ponytail: 20 invites per user per 6 hours (CacheService max TTL); MailApp itself allows ~100/day.
    var cache = CacheService.getScriptCache(), n = Number(cache.get(user.localId) || 0);
    if (n >= 20) return out({ ok: false, error: 'Invite limit reached. Copy the link instead.' });
    cache.put(user.localId, String(n + 1), 21600);

    var from = user.displayName || user.email;
    var ws = String(req.workspace || 'a workspace').slice(0, 120);
    var esc = function (s) { return String(s).replace(/[&<>"]/g, function (c) { return '&#' + c.charCodeAt(0) + ';'; }); };
    MailApp.sendEmail({
      to: req.to,
      replyTo: user.email,
      name: 'Envoy',
      subject: from + ' invited you to "' + ws + '" on Envoy',
      body: from + ' invited you to their Envoy workspace "' + ws + '".\n\nOpen: ' + req.link + '\nAccess code: ' + req.code,
      htmlBody: '<div style="font:15px/1.6 -apple-system,Segoe UI,sans-serif;max-width:480px;margin:auto;padding:24px">'
        + '<h2 style="font-weight:600;margin:0 0 8px">You\'re invited to ' + esc(ws) + '</h2>'
        + '<p style="color:#555">' + esc(from) + ' shared their Envoy workspace with you: research, drafts and prep for your conference or tournament.</p>'
        + '<p><a href="' + esc(req.link) + '" style="display:inline-block;background:#4F46E5;color:#fff;text-decoration:none;padding:10px 18px;border-radius:8px">Join workspace</a></p>'
        + '<p style="color:#555">Or enter this code on the Workspaces page: <b style="font-family:monospace;letter-spacing:2px">' + esc(req.code) + '</b></p></div>',
    });
    return out({ ok: true });
  } catch (err) {
    return out({ ok: false, error: String(err).slice(0, 200) });
  }
}

function out(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}
