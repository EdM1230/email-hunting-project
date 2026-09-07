/**
 * Static domain intelligence used by the heuristic stages.
 *
 * These lists are deliberately small and high-signal. To extend them without
 * touching code, drop newline-separated domains into `data/disposable.txt` or
 * `data/free.txt` at the project root - `loadExternalLists()` merges them in
 * at boot. Public lists worth importing are linked in the README.
 */

/** Temporary / burner mailbox providers. Mail here is worthless for outreach. */
export const DISPOSABLE_DOMAINS = new Set<string>([
  '0-mail.com', '10minutemail.com', '10minutemail.net', '20minutemail.com',
  '33mail.com', 'anonbox.net', 'anonymbox.com', 'armyspy.com', 'binkmail.com',
  'bobmail.info', 'bugmenot.com', 'burnermail.io', 'byom.de', 'cool.fr.nf',
  'correo.blogos.net', 'cust.in', 'dayrep.com', 'deadaddress.com',
  'despam.it', 'devnullmail.com', 'discard.email', 'discardmail.com',
  'disposableinbox.com', 'dispostable.com', 'dodgeit.com', 'dodgit.com',
  'dontreg.com', 'dontsendmespam.de', 'dropmail.me', 'e4ward.com',
  'einrot.com', 'emailfake.com', 'emailondeck.com', 'emailsensei.com',
  'emailtemporanea.net', 'emailtemporario.com.br', 'emltmp.com',
  'ephemail.net', 'explodemail.com', 'fakeinbox.com', 'fakemail.net',
  'fakemailgenerator.com', 'fastacura.com', 'filzmail.com', 'fleckens.hu',
  'fudgerub.com', 'garbagemail.org', 'get2mail.fr', 'getairmail.com',
  'getnada.com', 'ghosttexter.de', 'grr.la', 'guerrillamail.biz',
  'guerrillamail.com', 'guerrillamail.de', 'guerrillamail.info',
  'guerrillamail.net', 'guerrillamail.org', 'guerrillamailblock.com',
  'harakirimail.com', 'hidemail.de', 'incognitomail.com', 'inboxalias.com',
  'inboxbear.com', 'inboxkitten.com', 'jetable.org', 'jourrapide.com',
  'kasmail.com', 'killmail.com', 'klzlk.com', 'koszmail.pl', 'kurzepost.de',
  'lackmail.net', 'lroid.com', 'luxusmail.org', 'mailcatch.com',
  'maildrop.cc', 'maileater.com', 'mailexpire.com', 'mailforspam.com',
  'mailfreeonline.com', 'mailinater.com', 'mailinator.com', 'mailinator.net',
  'mailinator.org', 'mailincubator.com', 'mailmetrash.com', 'mailmoat.com',
  'mailnesia.com', 'mailnull.com', 'mailsac.com', 'mailslurp.com',
  'mailtemp.info', 'mailtothis.com', 'mintemail.com', 'moakt.com',
  'mohmal.com', 'msgden.com', 'mt2015.com', 'mytemp.email', 'mytempemail.com',
  'nomail.xl.cx', 'nospam.ze.tc', 'notmailinator.com', 'nowmymail.com',
  'objectmail.com', 'onewaymail.com', 'owlpic.com', 'pokemail.net',
  'proxymail.eu', 'rcpt.at', 'rhyta.com', 'rmqkr.net', 'safetymail.info',
  'sharklasers.com', 'shieldemail.com', 'shortmail.net', 'slopsbox.com',
  'smashmail.de', 'sneakemail.com', 'sofort-mail.de', 'sogetthis.com',
  'spam4.me', 'spamavert.com', 'spambog.com', 'spambox.us', 'spamcowboy.com',
  'spamdecoy.net', 'spamex.com', 'spamfree24.org', 'spamgourmet.com',
  'spamherelots.com', 'spamhole.com', 'spaml.de', 'spamspot.com',
  'spamthis.co.uk', 'spamtrail.com', 'superrito.com', 'suremail.info',
  'tafmail.com', 'teleworm.us', 'temp-mail.io', 'temp-mail.org',
  'tempail.com', 'tempemail.com', 'tempemail.net', 'tempinbox.com',
  'tempmail.de', 'tempmail.net', 'tempmail.plus', 'tempmailaddress.com',
  'tempmailer.com', 'tempomail.fr', 'temporaryemail.net',
  'temporaryinbox.com', 'thankyou2010.com', 'thisisnotmyrealemail.com',
  'throwam.com', 'throwawaymail.com', 'tmail.ws', 'tmailinator.com',
  'trash-mail.at', 'trash-mail.com', 'trash2009.com', 'trashmail.com',
  'trashmail.de', 'trashmail.me', 'trashmail.net', 'trashmail.org',
  'trbvm.com', 'trialmail.de', 'tyldd.com', 'uroid.com', 'vpn.st',
  'wegwerfmail.de', 'wegwerfmail.net', 'wegwerfmail.org', 'wh4f.org',
  'whyspam.me', 'willhackforfood.biz', 'wuzup.net', 'yepmail.net',
  'yopmail.com', 'yopmail.fr', 'yopmail.net', 'zetmail.com', 'zoemail.com',
]);

/** Free consumer mailbox providers. Valid, but a weak B2B signal. */
export const FREE_PROVIDERS = new Set<string>([
  'aim.com', 'alice.it', 'aol.com', 'arcor.de', 'att.net', 'bellsouth.net',
  'bigpond.com', 'bluewin.ch', 'bol.com.br', 'btinternet.com', 'charter.net',
  'comcast.net', 'cox.net', 'earthlink.net', 'email.com', 'fastmail.com',
  'fastmail.fm', 'free.fr', 'freenet.de', 'gmail.com', 'gmx.at', 'gmx.com',
  'gmx.de', 'gmx.net', 'googlemail.com', 'hey.com', 'hotmail.co.uk',
  'hotmail.com', 'hotmail.de', 'hotmail.es', 'hotmail.fr', 'hotmail.it',
  'hush.com', 'hushmail.com', 'icloud.com', 'inbox.com', 'inbox.lv',
  'juno.com', 'laposte.net', 'libero.it', 'live.co.uk', 'live.com',
  'live.fr', 'live.nl', 'mac.com', 'mail.com', 'mail.ru', 'me.com',
  'msn.com', 'nate.com', 'naver.com', 'netzero.net', 'ntlworld.com',
  'o2.pl', 'onet.pl', 'optonline.net', 'orange.fr', 'outlook.com',
  'outlook.de', 'outlook.fr', 'pobox.com', 'proton.me', 'protonmail.ch',
  'protonmail.com', 'qq.com', 'rambler.ru', 'rediffmail.com', 'rocketmail.com',
  'sbcglobal.net', 'seznam.cz', 'sfr.fr', 'shaw.ca', 'sina.com', 'sky.com',
  'skynet.be', 'sympatico.ca', 't-online.de', 'talktalk.co.uk', 'tin.it',
  'tiscali.it', 'tuta.com', 'tutanota.com', 'tutanota.de', 'uol.com.br',
  'verizon.net', 'virgilio.it', 'virginmedia.com', 'voila.fr', 'wanadoo.fr',
  'web.de', 'windowslive.com', 'wp.pl', 'xs4all.nl', 'yahoo.ca',
  'yahoo.co.id', 'yahoo.co.in', 'yahoo.co.jp', 'yahoo.co.uk', 'yahoo.com',
  'yahoo.com.au', 'yahoo.com.br', 'yahoo.de', 'yahoo.es', 'yahoo.fr',
  'yahoo.it', 'yandex.com', 'yandex.ru', 'ymail.com', 'zoho.com', 'zohomail.com',
]);

/**
 * Shared-inbox local parts. These usually exist but are read by nobody in
 * particular, so cold outreach to them converts poorly - hence "risky".
 */
export const ROLE_ACCOUNTS = new Set<string>([
  'abuse', 'accounting', 'accounts', 'admin', 'administrator', 'ads',
  'billing', 'business', 'ceo', 'certificates', 'compliance', 'contact',
  'customerservice', 'dev', 'devnull', 'donotreply', 'enquiries', 'enquiry',
  'everyone', 'feedback', 'finance', 'ftp', 'help', 'helpdesk', 'hello',
  'hostmaster', 'hr', 'info', 'inquiries', 'inquiry', 'investors', 'it',
  'jobs', 'legal', 'mail', 'mailer-daemon', 'maildaemon', 'marketing',
  'media', 'newsletter', 'no-reply', 'noc', 'noreply', 'office',
  'orders', 'partners', 'payments', 'postmaster', 'press', 'privacy',
  'purchasing', 'recruiting', 'recruitment', 'root', 'sales', 'security',
  'service', 'shop', 'signup', 'spam', 'subscribe', 'support', 'sysadmin',
  'team', 'tech', 'security-team', 'unsubscribe', 'usenet', 'uucp',
  'webmaster', 'welcome', 'www',
]);

/** Registrar parking pages and for-sale placeholders. */
export const PARKED_DOMAIN_MX = [
  'parkingcrew.net',
  'sedoparking.com',
  'bodis.com',
  'above.com',
  'dan.com',
  'afternic.com',
  'undeveloped.com',
];

/**
 * Typo -> correction for the domains people fat-finger most. Used to surface a
 * "did you mean" hint rather than to silently rewrite the address.
 */
export const COMMON_TYPOS = new Map<string, string>([
  ['gmial.com', 'gmail.com'], ['gmai.com', 'gmail.com'],
  ['gmail.co', 'gmail.com'], ['gmail.cm', 'gmail.com'],
  ['gmailc.om', 'gmail.com'], ['gmaill.com', 'gmail.com'],
  ['gnail.com', 'gmail.com'], ['gamil.com', 'gmail.com'],
  ['gmal.com', 'gmail.com'], ['gmail.con', 'gmail.com'],
  ['hotmial.com', 'hotmail.com'], ['hotmai.com', 'hotmail.com'],
  ['hotmail.co', 'hotmail.com'], ['hotmail.con', 'hotmail.com'],
  ['hotnail.com', 'hotmail.com'], ['homtail.com', 'hotmail.com'],
  ['yahooo.com', 'yahoo.com'], ['yaho.com', 'yahoo.com'],
  ['yahoo.co', 'yahoo.com'], ['yahoo.con', 'yahoo.com'],
  ['yhaoo.com', 'yahoo.com'], ['yahho.com', 'yahoo.com'],
  ['outlok.com', 'outlook.com'], ['outllok.com', 'outlook.com'],
  ['outlook.co', 'outlook.com'], ['outook.com', 'outlook.com'],
  ['iclould.com', 'icloud.com'], ['icloud.co', 'icloud.com'],
  ['iclod.com', 'icloud.com'], ['protonmai.com', 'protonmail.com'],
  ['live.co', 'live.com'], ['aol.co', 'aol.com'],
]);
