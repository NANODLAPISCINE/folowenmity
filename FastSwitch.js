/**
 * FastSwitch — plugin Enmity (Discord iOS)
 *
 * Bascule rapidement entre les comptes du multi-comptes NATIF de Discord
 * (le même qui est limité à 5 comptes). Les sessions sont gérées et stockées
 * par Discord lui-même, de façon chiffrée, sur l'appareil.
 *
 * Ce plugin NE lit, NE stocke et N'envoie aucun token ni mot de passe.
 * Il se contente d'appeler la fonction interne switchAccount(id) de Discord,
 * et de lire pseudo + avatar pour l'affichage.
 *
 * Pour ajouter un compte : connecte-toi normalement via "Ajouter un compte"
 * de Discord. Il apparaît ensuite ici.
 *
 * Commandes :
 *   /switch          liste tes comptes, bascule vers le premier autre
 *   /accounts        liste tes comptes et leur position
 */
(() => {
  'use strict';

  const enmity = window.enmity;
  const NAME = 'FastSwitch';
  const MAX_ACCOUNTS = 5; // limite du multi-comptes natif de Discord

  const { React, Toasts } = enmity.modules.common;
  const { FormRow, FormSection, FormDivider, ScrollView, Text } = enmity.components;
  const h = React.createElement;

  let UserStore, SwitchModule, AccountsStore;

  function findModule(...candidates) {
    for (const props of candidates) {
      const mod = enmity.modules.getByProps(...props);
      if (mod) return mod;
    }
    return null;
  }

  // Résolution à la demande. On ne touche jamais aux méthodes liées aux tokens.
  function loadModules() {
    UserStore = UserStore || findModule(['getCurrentUser', 'getUser']);
    // Fonction native de bascule : switchAccount(userId)
    SwitchModule = SwitchModule || findModule(['switchAccount'], ['switchAccountToken']);
    // Store des comptes du multi-comptes natif (liste d'identités, pas de tokens)
    AccountsStore =
      AccountsStore ||
      findModule(['getAccounts'], ['getUsers', 'getCurrentUser'], ['getAllAccounts'], ['getSwitchAccounts']);

    const missing = [];
    if (!UserStore) missing.push('UserStore');
    if (!SwitchModule || typeof SwitchModule.switchAccount !== 'function') missing.push('switchAccount');
    if (!AccountsStore) missing.push('AccountsStore');
    if (missing.length) console.log(`[${NAME}] introuvable : ${missing.join(', ')}`);
    return missing;
  }

  function toast(content) {
    try {
      const source = enmity.assets.getIDByName('ic_my_account_24px') || enmity.assets.getIDByName('Check');
      Toasts.open(source ? { content, source } : { content });
    } catch (e) {
      console.log(`[${NAME}] toast impossible`, e);
    }
  }

  // Renvoie [{ id, username }] pour les comptes connectés, sans jamais lire de token.
  function getAccounts() {
    if (!AccountsStore) return [];
    let raw = null;
    for (const method of ['getAccounts', 'getUsers', 'getAllAccounts', 'getSwitchAccounts']) {
      if (typeof AccountsStore[method] === 'function') {
        try {
          raw = AccountsStore[method]();
          if (raw) break;
        } catch (e) {
          /* on essaie la méthode suivante */
        }
      }
    }
    if (!raw) return [];

    const list = Array.isArray(raw) ? raw : Object.values(raw);
    return list
      .map((entry) => {
        // Selon la forme du store : soit {id, username}, soit {user: {...}}
        const user = entry && entry.user ? entry.user : entry;
        if (!user || !user.id) return null;
        return { id: String(user.id), username: user.username || user.globalName || user.id };
      })
      .filter(Boolean)
      .slice(0, MAX_ACCOUNTS);
  }

  function switchTo(id) {
    try {
      SwitchModule.switchAccount(id);
      return true;
    } catch (e) {
      console.log(`[${NAME}] bascule impossible`, e);
      toast('Bascule impossible');
      return false;
    }
  }

  function nameOf(id) {
    const user = UserStore && UserStore.getUser && UserStore.getUser(id);
    if (user) return user.globalName || user.username || id;
    const match = getAccounts().find((a) => a.id === id);
    return match ? match.username : id;
  }

  // Réponse visible seulement par toi dans le salon de la commande
  function reply(message, content) {
    const channelId = message && message.channel && message.channel.id;
    try {
      if (channelId && enmity.clyde) return enmity.clyde.sendReply(channelId, content);
    } catch (e) {
      console.log(`[${NAME}] réponse impossible`, e);
    }
    toast(content);
  }

  const commands = [
    {
      name: 'switch',
      displayName: 'switch',
      description: 'Basculer vers le compte suivant (multi-comptes natif de Discord)',
      displayDescription: 'Basculer vers le compte suivant (multi-comptes natif de Discord)',
      options: [],
      execute(args, message) {
        const missing = loadModules();
        if (missing.length) {
          return reply(message, `${NAME} ne trouve pas le multi-comptes natif (${missing.join(', ')}). Ajoute d'abord un compte via Discord.`);
        }

        const accounts = getAccounts();
        const me = UserStore.getCurrentUser();
        const others = accounts.filter((a) => !me || a.id !== me.id);

        if (!others.length) {
          return reply(message, "Aucun autre compte. Ajoute-en un via « Ajouter un compte » de Discord.");
        }

        const target = others[0];
        if (switchTo(target.id)) reply(message, `Bascule vers **${target.username}**.`);
      },
    },
    {
      name: 'accounts',
      displayName: 'accounts',
      description: 'Lister tes comptes connectés',
      displayDescription: 'Lister tes comptes connectés',
      options: [],
      execute(args, message) {
        const missing = loadModules();
        if (missing.length) {
          return reply(message, `${NAME} ne trouve pas le multi-comptes natif (${missing.join(', ')}).`);
        }

        const accounts = getAccounts();
        if (!accounts.length) return reply(message, 'Aucun compte trouvé.');

        const me = UserStore.getCurrentUser();
        const lines = accounts.map((a, i) => `${i + 1}. ${a.username}${me && a.id === me.id ? '  (actuel)' : ''}`);
        reply(message, `**Comptes (${accounts.length}/${MAX_ACCOUNTS})**\n> ${lines.join('\n> ')}`);
      },
    },
  ];

  function SettingsPanel() {
    const missing = loadModules();
    if (missing.length) {
      return h(
        ScrollView,
        null,
        h(FormSection, { title: NAME }, h(FormRow, {
          label: 'Multi-comptes natif introuvable',
          subLabel: `Ajoute un compte via Discord, puis rouvre. (${missing.join(', ')})`,
        }))
      );
    }

    const accounts = getAccounts();
    const me = UserStore.getCurrentUser();

    const rows = accounts.map((a) =>
      h(FormRow, {
        key: a.id,
        label: a.username,
        subLabel: me && a.id === me.id ? 'Compte actuel' : 'Appuie pour basculer',
        onPress: me && a.id === me.id ? undefined : () => { if (switchTo(a.id)) toast(`Bascule vers ${a.username}`); },
      })
    );

    return h(
      ScrollView,
      null,
      h(
        FormSection,
        { title: `Comptes (${accounts.length}/${MAX_ACCOUNTS})` },
        accounts.length ? rows : h(FormRow, { label: 'Aucun compte', subLabel: "Ajoute-en via Discord" })
      ),
      Text
        ? h(FormSection, { title: 'Info' }, h(FormRow, {
            label: 'Aucun token stocké',
            subLabel: 'Les sessions sont gérées par Discord. Ce plugin ne lit ni token ni mot de passe.',
          }))
        : null
    );
  }

  const FastSwitch = {
    name: NAME,
    version: '1.0.0',
    description: 'Bascule rapide entre les comptes du multi-comptes natif de Discord. Sans token.',
    authors: [{ name: 'NANODLAPISCINE', id: '000000000000000000' }], // remplace par ton ID Discord
    color: '#64D3FF',

    onStart() {
      // Commandes d'abord, pour qu'elles apparaissent même si un module manque.
      for (const command of commands) enmity.commands.registerCommands(NAME, [command]);
      loadModules();
    },

    onStop() {
      enmity.commands.unregisterCommands(NAME);
    },

    getSettingsPanel() {
      return h(SettingsPanel);
    },
  };

  enmity.plugins.registerPlugin(FastSwitch);
})();
