import {
  Client,
  GatewayIntentBits,
  Events,
  Message,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ButtonInteraction,
  PermissionsBitField,
  Guild,
  MessageReplyOptions,
  Role,
} from 'discord.js';
import 'dotenv/config';
import * as fs from 'fs/promises';
import * as path from 'path';

// Path to the users.json file
const USERS_FILE = path.join(__dirname, 'users.json');

// Interface for verification data
interface VerificationData {
  question: string;
  answer: string;
  guildId: string;
  expires: number;
}

// Create a map to store verification questions
const verificationQuestions = new Map<string, VerificationData>();

// Create a map to store user message timestamps
const userMessages = new Map<string, number[]>();

// Sample questions for verification
const QUESTIONS = [
  { question: 'What is 5 + 3?', answer: '8' },
  { question: 'Type "human" to verify.', answer: 'human' },
  { question: 'What color is the sky on a clear day?', answer: 'blue' },
];

// Cache for verified users
let verifiedUsersCache = new Set<string>();

// Initialize client with intents
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.DirectMessages,
  ],
});

// Ensure users.json exists
async function initializeUsersFile() {
  try {
    await fs.access(USERS_FILE);
    console.log('Users file exists:', USERS_FILE);
  } catch {
    console.log('Creating users file:', USERS_FILE);
    await fs.writeFile(USERS_FILE, JSON.stringify([]));
  }
}

// Load verified users into cache
async function loadUsersCache() {
  try {
    const data = await fs.readFile(USERS_FILE, 'utf8');
    verifiedUsersCache = new Set(JSON.parse(data));
  } catch (error) {
    console.error('Error loading users cache:', error);
  }
}

// Add username to file and cache
async function addVerifiedUser(username: string) {
  try {
    if (!verifiedUsersCache.has(username)) {
      verifiedUsersCache.add(username);
      await fs.writeFile(USERS_FILE, JSON.stringify([...verifiedUsersCache], null, 2));
      console.log(`Added ${username} to verified users`);
    }
  } catch (error) {
    console.error('Error adding user to file:', error);
  }
}

// Prompt server owner for permissions
async function promptOwnerForPermissions(guild: Guild) {
  try {
    const owner = await guild.fetchOwner();
    if (!client.user) {
      console.error('Client user is not available');
      return;
    }
    await owner.send(
      `Hello! I'm ${client.user.tag} in your server **${guild.name}**. I need the **Manage Roles** permission to assign the "verified" and "Stunnerr" roles. Please go to **Server Settings > Roles**, select my role, and enable **Manage Roles**. Alternatively, re-invite me with the correct permissions using this link: [Invite Link](https://discord.com/oauth2/authorize?client_id=${client.user.id}&scope=bot&permissions=268435456)`
    );
    console.log(`Sent permission prompt to owner ${owner.user.tag} for guild ${guild.name}`);
  } catch (error) {
    console.error(`Failed to DM owner for guild ${guild.name}:`, error);
  }
}

// Create or get the Stunnerr role
async function getOrCreateStunnerrRole(guild: Guild): Promise<Role | null> {
  try {
    // Check if the role already exists
    let role = guild.roles.cache.find((r) => r.name === 'Stunnerr');
    if (role) return role;

    // Check bot permissions
    const botMember = guild.members.me;
    if (!botMember?.permissions.has(PermissionsBitField.Flags.ManageRoles)) {
      await promptOwnerForPermissions(guild);
      console.log(`Cannot create Stunnerr role in ${guild.name}: Missing Manage Roles permission`);
      return null;
    }

    // Create the Stunnerr role
    role = await guild.roles.create({
      name: 'Stunnerr',
      color: 0x0000FF, // Use hex code for blue
      // color: 'BLUE', // Distinct color for the role
      reason: 'Created for users who send 2 messages within 1 minute',
      permissions: [], // No special permissions, just a visible role
    });
    console.log(`Created Stunnerr role in ${guild.name}`);
    return role;
  } catch (error) {
    console.error(`Error creating Stunnerr role in ${guild.name}:`, error);
    return null;
  }
}

// Event: Bot is ready
client.once(Events.ClientReady, async () => {
  await initializeUsersFile();
  await loadUsersCache();
  console.log(`✅ Logged in as ${client.user?.tag} (${client.user?.id})`);
});

// Event: Bot joins a server
client.on(Events.GuildCreate, async (guild: Guild) => {
  const botMember = guild.members.me;
  if (!botMember?.permissions.has(PermissionsBitField.Flags.ManageRoles)) {
    console.log(`Missing Manage Roles permission in ${guild.name}`);
    await promptOwnerForPermissions(guild);
  } else {
    console.log(`Bot has Manage Roles permission in ${guild.name}`);
  }
});

// Event: Handle server messages
client.on(Events.MessageCreate, async (message: Message) => {
  if (message.author.bot || !message.guild) return;

  const userId = message.author.id;
  const guild = message.guild;
  const currentTime = Date.now();

  // Track message timestamps for Stunnerr role
  let timestamps = userMessages.get(userId) || [];
  timestamps = timestamps.filter((time) => currentTime - time < 60 * 1000); // Keep messages within 1 minute
  timestamps.push(currentTime);
  userMessages.set(userId, timestamps);

  // Check if user sent 2 messages within 1 minute
  if (timestamps.length >= 2) {
    try {
      const botMember = guild.members.me;
      if (!botMember?.permissions.has(PermissionsBitField.Flags.ManageRoles)) {
        await promptOwnerForPermissions(guild);
        await message.reply({
          content: `${message.author}, I cannot assign the Stunnerr role due to missing "Manage Roles" permission. The server owner has been notified.`,
        });
        return;
      }

      const role = await getOrCreateStunnerrRole(guild);
      if (!role) {
        await message.reply({
          content: `${message.author}, I couldn’t create or find the Stunnerr role. Please contact an admin.`,
        });
        return;
      }

      const member = await guild.members.fetch(userId);
      if (!member.roles.cache.has(role.id)) {
        // Check role hierarchy
        if (botMember.roles.highest.position <= role.position) {
          console.error(`Bot's role is not higher than Stunnerr role in ${guild.name}`);
          await message.reply({
            content: `${message.author}, I cannot assign the Stunnerr role because my role is not high enough. Please ask an admin to adjust role hierarchy.`,
          });
          return;
        }

        await member.roles.add(role);
        await message.reply({
          content: `${message.author}, you’ve been assigned the **Stunnerr** role for sending 2 messages within 1 minute! 🎉`,
        });
        console.log(`Assigned Stunnerr role to ${message.author.tag} in ${guild.name}`);
      }

      // Clear timestamps after assigning the role to prevent repeated assignments
      userMessages.delete(userId);
    } catch (error) {
      console.error(`Error assigning Stunnerr role to ${message.author.tag}:`, error);
      await message.reply({
        content: `${message.author}, an error occurred while assigning the Stunnerr role. Please contact an admin.`,
      });
    }
  }

  // Existing verification logic
  const isVerified = verifiedUsersCache.has(message.author.tag);
  if (!isVerified) {
    try {
      // Check bot permissions
      const botMember = message.guild.members.me;
      if (!botMember?.permissions.has(PermissionsBitField.Flags.ManageRoles)) {
        await promptOwnerForPermissions(message.guild);
        const replyOptions: MessageReplyOptions = {
          content: `${message.author}, verification is paused because I lack the "Manage Roles" permission. The server owner has been notified to grant it.`,
        };
        await message.reply(replyOptions);
        return;
      }

      const verifyButton = new ButtonBuilder()
        .setCustomId('start_verification')
        .setLabel('Verify Account')
        .setStyle(ButtonStyle.Primary);

      const row = new ActionRowBuilder<ButtonBuilder>().addComponents(verifyButton);
      const replyOptions: MessageReplyOptions = {
        content: `${message.author}, you must verify your account. Click the button below to start:`,
        components: [row],
      };
      await message.reply(replyOptions);
      console.log(`Sent verification prompt to ${message.author.tag}`);
    } catch (err) {
      console.error(`Could not send prompt to ${message.author.tag}:`, err);
    }
  }
});

// Event: Handle button interactions
client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isButton() || interaction.customId !== 'start_verification') return;

  const buttonInteraction = interaction as ButtonInteraction;
  const user = buttonInteraction.user;
  const guildId = buttonInteraction.guild?.id;

  // Defer reply to acknowledge interaction within 3 seconds
  try {
    await buttonInteraction.deferReply({ ephemeral: true });
  } catch (err) {
    console.error(`Failed to defer interaction for ${user.tag}:`, err);
    return;
  }

  try {
    // Check bot permissions
    const guild = buttonInteraction.guild;
    if (!guild) {
      await buttonInteraction.editReply({ content: '❌ This command can only be used in a server.' });
      return;
    }
    const botMember = guild.members.me;
    if (!botMember?.permissions.has(PermissionsBitField.Flags.ManageRoles)) {
      await promptOwnerForPermissions(guild);
      await buttonInteraction.editReply({
        content: '❌ I lack the "Manage Roles" permission. The server owner has been notified to grant it.',
      });
      return;
    }

    // Check if already verified
    if (verifiedUsersCache.has(user.tag)) {
      await buttonInteraction.editReply({ content: '✅ You are already verified!' });
      return;
    }

    // Check for existing verification attempt
    if (verificationQuestions.has(user.id)) {
      await buttonInteraction.editReply({ content: '⚠️ You have an ongoing verification. Check your DMs!' });
      return;
    }

    // Select random question
    const randomQuestion = QUESTIONS[Math.floor(Math.random() * QUESTIONS.length)];
    verificationQuestions.set(user.id, {
      question: randomQuestion.question,
      answer: randomQuestion.answer.toLowerCase(),
      guildId: guildId!,
      expires: Date.now() + 5 * 60 * 1000, // 5-minute timeout
    });

    // Send DM with question
    try {
      await user.send(
        `🔐 To verify you're not a bot, answer this: **${randomQuestion.question}**\nReply with your answer.`
      );
      await buttonInteraction.editReply({ content: '📬 Check your DMs for a verification question!' });
    } catch {
      verificationQuestions.delete(user.id);
      await buttonInteraction.editReply({
        content: '❌ I couldn’t DM you. Please enable DMs from server members.',
      });
    }

    // Log interaction
    console.log(`Verification started for ${user.tag} in guild ${guildId}`);
  } catch (err) {
    console.error(`Error handling interaction for ${user.tag}:`, err);
    await buttonInteraction.editReply({ content: '❌ An error occurred. Please try again later.' }).catch(() => {});
  }
});

// Event: Handle DM responses (Verification answer check)
client.on(Events.MessageCreate, async (dmMessage: Message) => {
  if (dmMessage.guild || dmMessage.author.bot) return;

  const questionData = verificationQuestions.get(dmMessage.author.id);
  if (!questionData) return;

  // Check if verification expired
  if (Date.now() > questionData.expires) {
    verificationQuestions.delete(dmMessage.author.id);
    await dmMessage.reply('❌ Verification expired. Click the "Verify Account" button again.');
    return;
  }

  if (dmMessage.content.trim().toLowerCase() === questionData.answer) {
    verificationQuestions.delete(dmMessage.author.id);

    const mutualGuild = client.guilds.cache.get(questionData.guildId);
    if (!mutualGuild) {
      await dmMessage.reply('⚠️ Could not find the server to assign the role.');
      return;
    }

    try {
      const member = await mutualGuild.members.fetch(dmMessage.author.id);
      await mutualGuild.roles.fetch(); // Refresh role cache
      console.log(`Checking guild: ${mutualGuild.name} (${questionData.guildId})`);

      // Check bot permissions
      const botMember = mutualGuild.members.me;
      if (!botMember?.permissions.has(PermissionsBitField.Flags.ManageRoles)) {
        await promptOwnerForPermissions(mutualGuild);
        await dmMessage.reply(
          '❌ I lack the "Manage Roles" permission to assign roles. The server owner has been notified.'
        );
        return;
      }

      const role = mutualGuild.roles.cache.find((r) => r.name === 'verified');
      if (!role) {
        console.log('Available roles:', mutualGuild.roles.cache.map((r) => r.name));
        await dmMessage.reply('⚠️ "verified" role not found. Please ask the admin to create it or check its name.');
        return;
      }

      // Check role hierarchy
      if (botMember.roles.highest.position <= role.position) {
        console.error(`Bot's role is not higher than verified role in ${mutualGuild.name}`);
        await dmMessage.reply(
          '❌ My role is not high enough to assign the "verified" role. Please ask an admin to adjust role hierarchy.'
        );
        return;
      }

      console.log(`Attempting to assign verified role to ${dmMessage.author.tag}`);
      await member.roles.add(role);
      await addVerifiedUser(dmMessage.author.tag);
      await dmMessage.reply('✅ You have been successfully verified and assigned the verified role!');
      console.log(`Verified ${dmMessage.author.tag} and assigned verified role in guild ${questionData.guildId}`);
    } catch (err) {
      console.error(`Error assigning role for ${dmMessage.author.tag}:`, err);
      await dmMessage.reply('❌ Could not assign the role. Please contact an admin.');
    }
  } else {
    await dmMessage.reply('❌ Incorrect answer. Please try again.');
  }
});

// Login to Discord
if (!process.env.BOT_TOKEN) {
  console.error('❌ BOT_TOKEN is not set in .env');
  process.exit(1);
}
client.login(process.env.BOT_TOKEN);