
import { Client, GatewayIntentBits, Events, Message, GuildMember, PartialGuildMember, ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import 'dotenv/config';
import * as fs from 'fs/promises';
import * as path from 'path';

// Path to the users.json file
const USERS_FILE = path.join(__dirname, 'users.json');

// Initialize client with intents
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
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

// Read usernames from file
async function getVerifiedUsers(): Promise<string[]> {
  try {
    const data = await fs.readFile(USERS_FILE, 'utf8');
    const users = JSON.parse(data);
    console.log('Verified users:', users);
    return users;
  } catch (error) {
    console.error('Error reading users file:', error);
    return [];
  }
}

// Add username to file
async function addVerifiedUser(username: string) {
  try {
    const users = await getVerifiedUsers();
    if (!users.includes(username)) {
      users.push(username);
      await fs.writeFile(USERS_FILE, JSON.stringify(users, null, 2));
      console.log(`Added ${username} to verified users`);
    }
  } catch (error) {
    console.error('Error adding user to file:', error);
  }
}

// Event: Bot is ready
client.once(Events.ClientReady, async () => {
  await initializeUsersFile();
  console.log(`Logged in as ${client.user?.tag} (${client.user?.id})`);
  console.log('Bot is ready to enforce verification, monitor usernames, messages, and server owner.');
});

// Event: Monitor messages and handle commands
client.on(Events.MessageCreate, async (message: Message) => {
  // Ignore bot messages and DMs
  if (message.author.id === client.user?.id || !message.guild) return;

  // Safely get channel name
  const channelName = message.channel.isTextBased() && 'name' in message.channel ? message.channel.name : 'Unknown';

  // Check if user is verified
  const verifiedUsers = await getVerifiedUsers();
  if (!verifiedUsers.includes(message.author.tag)) {
    try {
      // Delete the unverified user's message
      await message.delete();
      console.log(`Deleted unverified message from ${message.author.tag} in #${channelName}: ${message.content}`);

      // Create a verification button
      const verifyButton = new ButtonBuilder()
        .setLabel('Verify Account')
        .setStyle(ButtonStyle.Link)
        .setURL('https://your-verification-site.com/verify'); // Replace with your verification URL

      const row = new ActionRowBuilder<ButtonBuilder>().addComponents(verifyButton);

      // Send temporary verification prompt in the channel
      if (message.channel.isTextBased()) {
        // @ts-ignore
        const tempMessage = await message.channel.send({
            content: `${message.author}, you must verify your account to send messages. Click the button below to verify.`,
          components: [row],
        });
        console.log(`Sent temporary verification prompt to ${message.author.tag} in #${channelName}`);

        // Auto-delete after 10 seconds
        setTimeout(async () => {
          try {
            await tempMessage.delete();
            console.log(`Deleted temporary verification prompt for ${message.author.tag} in #${channelName}`);
          } catch (deleteError) {
            console.error(`Failed to delete temporary message for ${message.author.tag}:`, deleteError);
          }
        }, 10000);
      }
    } catch (error) {
      console.error(`Failed to handle unverified user ${message.author.tag} in #${channelName}:`, error);

      // Notify server owner if deletion or prompt fails
      try {
        const owner = await message.guild.fetchOwner();
        await owner.send(
            `Unable to restrict unverified user ${message.author.tag} in #${channelName}. ` +
            // @ts-ignore
            `Error: ${error.message}. Please check bot permissions (Manage Messages, Send Messages) and role hierarchy.`
        );
        console.log(`Notified server owner ${owner.user.tag} about issue`);
      } catch (ownerError) {
        console.error('Failed to notify server owner:', ownerError);
      }
    }
    return; // Stop processing unverified user's message
  }
  
  // Log message details (for verified users)
  const logMessage = `Message from ${message.author.tag} (ID: ${message.author.id}) in #${channelName} (Guild: ${message.guild.name}): ${message.content}`;
  console.log(logMessage);

  // !ping command
  if (message.content === '!ping') {
    await message.reply('Pong!');
  }

  // !owner command to fetch server owner
  if (message.content === '!owner') {
    try {
      const owner = await message.guild.fetchOwner();
      const ownerInfo = `Server Owner: ${owner.user.tag} (ID: ${owner.user.id})`;
      console.log(ownerInfo);
      await message.reply(ownerInfo);
    } catch (error) {
      console.error('Error fetching server owner:', error);
      await message.reply('Failed to fetch server owner. Please try again later.');
    }
  }

  // !verify command (for testing: manually add user to verified list)
  if (message.content === '!verify') {
    await addVerifiedUser(message.author.tag);
    await message.reply('You have been verified (for testing purposes). You can now send messages.');
  }
});

// Event: Monitor username or nickname changes
client.on(Events.GuildMemberUpdate, (oldMember: GuildMember | PartialGuildMember, newMember: GuildMember) => {
  if (
    oldMember.user.tag !== newMember.user.tag ||
    oldMember.nickname !== newMember.nickname
  ) {
    const logMessage = `
      User Update: ${oldMember.user.tag} (ID: ${oldMember.user.id})
      Before: Username=${oldMember.user.tag}, Nickname=${oldMember.nickname || 'None'}
      After: Username=${newMember.user.tag}, Nickname=${newMember.nickname || 'None'}
    `;
    console.log(logMessage);
  }
});

// Login to Discord
client.login(process.env.BOT_TOKEN);
// @ts-ignore