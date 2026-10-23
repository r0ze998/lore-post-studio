// LAN 公開で起動する前の確認。APP_PASSCODE がなければ起動しない。
if (!process.env.APP_PASSCODE) {
  console.error("APP_PASSCODE が未設定です。LAN で使う場合は APP_PASSCODE=好きな合言葉 を設定してください（ユーザー名は user）。");
  process.exit(1);
}
console.log("LAN 向けに起動します（Basic 認証あり・ユーザー名 user）。");
