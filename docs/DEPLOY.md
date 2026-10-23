# Web で使えるようにする（Vercel ＋ Supabase・無料枠）

ブラウザだけで使える構成です。画面とサーバーは **Vercel**、データは **Supabase**（データベース＋ファイル置き場）に置きます。
どちらも無料枠で始められます。所要時間は 15〜20 分ほどです。

```
ブラウザ ──合言葉──▶ Vercel（画面・API）──▶ Supabase Postgres（設定・投稿などの文書）
   │                                    └─▶ Supabase Storage（素材・zip、非公開）
   └──── 素材や zip は、短時間だけ有効な URL で Supabase と直接やり取り（Vercel の 4.5MB 制限を避ける）
```

## 1. Supabase を用意する

1. https://supabase.com でアカウントを作り、**New project** を作成します。
   - Region は **Northeast Asia (Tokyo)** を推奨（Vercel 側も東京にしてあります）。
   - Database Password は控えておきます。
2. 3 つの値を控えます。
   - **DATABASE_URL**：プロジェクト画面上部の **Connect** →「**Transaction pooler**」（ポート **6543**）の接続文字列をコピーし、`[YOUR-PASSWORD]` を自分のパスワードに置き換えます。
     パスワードに `&` `#` `?` `@` `/` や空白が含まれる場合は、その文字をパーセントエンコードしてください（例：`#` → `%23`）。
   - **SUPABASE_URL**：Connect ダイアログ、または Settings に表示される Project URL（`https://xxxx.supabase.co`）。
   - **SUPABASE_SECRET_KEY**：**Settings → API Keys** の **Secret key**（`sb_secret_...`）。
     従来の `service_role` キーを使う場合は、環境変数名を `SUPABASE_SERVICE_ROLE_KEY` にしてください。
     このキーは強い権限を持ちます。**どこにも貼り付けず、Vercel の環境変数にだけ入れてください。**

テーブル（`lps_docs`）と非公開のファイル置き場（バケット `lore-post-studio`）は、初めてアクセスしたときに自動で作られます。
テーブルは行レベルセキュリティを有効にして作るので、Supabase の公開 API からは読めません。

## 2. Vercel にデプロイする

1. https://vercel.com に GitHub アカウントでログインし、**Add New… → Project** から `r0ze998/lore-post-studio` を **Import** します。
2. Framework は自動で **Next.js** になります。そのまま **Environment Variables** に次を入れます。

   | 名前 | 値 |
   | --- | --- |
   | `STORAGE_BACKEND` | `supabase` |
   | `DATABASE_URL` | 1-2 で控えた接続文字列（6543 番） |
   | `SUPABASE_URL` | `https://xxxx.supabase.co` |
   | `SUPABASE_SECRET_KEY` | `sb_secret_...` |
   | `APP_PASSCODE` | 自分で決めた合言葉（**12 文字以上必須**。日本語も可） |
   | `ANTHROPIC_API_KEY` | （任意・有料）文章生成に API を使う場合のみ |

3. **Deploy** を押します。完了したら表示された URL を開きます。
4. ブラウザのログイン画面が出たら、ユーザー名 **`user`**、パスワードに **合言葉** を入れます。

### 注意

- `APP_PASSCODE` がない、または 12 文字未満だと、安全のため誰も開けない状態（503）になります。設定後に **Redeploy** してください。
- 環境変数を変えたら、Vercel の **Deployments → Redeploy** で反映します。
- 秘密の値に `NEXT_PUBLIC_` を付けないでください（付けるとブラウザに渡ります）。
- 合言葉は推測されにくいものにしてください。URL と合言葉を知っている人は誰でも中身を見られます。

## 3. PC で作ったデータを Web に移す（任意）

1. PC 版で各プロジェクトの「プロジェクト設定 → プロジェクトを zip で書き出す」。
2. Web 版のトップ画面「取り込み・サンプル」で zip を選んで取り込み（新しいプロジェクトとして追加）。

## 無料枠の主な制限（2026-10 時点。最新は各サービスで確認してください）

- **Supabase Free**：データベース 500MB、ファイル置き場 1GB、**ファイル 1 つ 50MB まで**（このツールの Web 版も 50MB を上限にしています）。
  しばらく使わないとプロジェクトが一時停止されることがあります（ダッシュボードから再開できます）。
- **Vercel Hobby**：個人・非商用向け。1 回の処理は最大 300 秒（API での文章生成もこの範囲で動きます）。

## うまくいかないとき

| 症状 | 確認すること |
| --- | --- |
| 503「公開環境では合言葉が必須です」 | `APP_PASSCODE` を 12 文字以上で設定 → Redeploy |
| 「設定が足りません：…」と表示される | 表示された環境変数を Vercel に追加 → Redeploy |
| 読み込みが終わらない・DB エラー | `DATABASE_URL` が **6543 番（Transaction pooler）** か、パスワードの置き換え・エンコードが正しいか |
| 素材のアップロードに失敗する | `SUPABASE_URL` と `SUPABASE_SECRET_KEY` が同じプロジェクトのものか。ファイルが 50MB 以下か |

## 仕組みと検証の範囲（開発メモ）

- 保存先は `src/lib/server/backend/` で切り替えます（`file` = PC、`supabase` = Web）。業務のルールは共通です。
- 文書は版番号つきで保存し、複数のサーバーが同時に書いても上書きで消えないよう、照合して再試行します。
- Postgres への問い合わせは 1 本の接続で 1 つずつ送ります（Supabase の Transaction pooler の注意事項に従い、prepared statement とパイプライン送信を使いません）。
- 手元での検証：
  - 保存先のテストを PGlite と **実際の PostgreSQL 16（本番と同じドライバ）** で実行（`PG_TEST_URL=... npx vitest run tests/unit/store-postgres.test.ts`）。
  - アプリ全体を実際の PostgreSQL に保存する構成で、PC・スマホ相当のブラウザの E2E を実行（`PG_E2E_URL=... npm run e2e`）。
    ファイル置き場の部分は、Supabase Storage と同じ受け渡し形式のテスト用の口（`/api/test-blob`、テスト時のみ有効）で代用しています。
- **本物の Supabase Storage と Vercel 上での動作は、デプロイ後に確認が必要です**（このリポジトリの開発環境からは両サービスにアクセスしていません）。
