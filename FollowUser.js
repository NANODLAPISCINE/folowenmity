/**
 * FollowUser — plugin Enmity (Discord iOS)
 *
 * Suit automatiquement un utilisateur dans les salons vocaux :
 * quand il rejoint ou change de salon vocal, tu le rejoins.
 *
 * Commandes :
 *   /follow <utilisateur>   commence à suivre quelqu'un
 *   /unfollow               arrête de suivre
 *
 * L'utilisateur suivi et les options sont aussi réglables dans
 * Enmity > Plugins > FollowUser > Paramètres.
 */
(() => {
  'use strict';

  const enmity = window.enmity;
  const NAME = 'FollowUser';

  const { React, Toasts } = enmity.modules.common;
  const { FormRow, FormSwitch, FormInput, FormSection, FormDivider, ScrollView } = enmity.components;
  const h = React.createElement;

  // Valeur de l'enum ApplicationCommandOptionType de Discord
  const OPTION_TYPE_USER = 6;

  const DEFAULTS = {
    targetId: '',
    joinOnFollow: true,
    followLeave: false,
    onlyWhenInVoice: false,
    showToasts: true,
  };

  const getSetting = (key) => enmity.settings.get(NAME, key, DEFAULTS[key]);
  const setSetting = (key, value) => enmity.settings.set(NAME, key, value);

  let Dispatcher, UserStore, ChannelStore, VoiceStateStore, SelectedChannelStore, VoiceActions;
  let subscribed = false;
  let lastTargetChannel = null;

  // Essaie plusieurs combinaisons de props, au cas où Discord renomme un module
  function findModule(...candidates) {
    for (const props of candidates) {
      const mod = enmity.modules.getByProps(...props);
      if (mod) return mod;
    }
    return null;
  }

  // Résolus à la demande : un module introuvable ne doit pas empêcher les commandes d'apparaître
  function loadModules() {
    Dispatcher = Dispatcher || enmity.modules.common.Dispatcher || findModule(['dispatch', 'subscribe']);
    UserStore = UserStore || findModule(['getCurrentUser', 'getUser']);
    ChannelStore = ChannelStore || findModule(['getChannel', 'getDMFromUserId'], ['getChannel']);
    VoiceStateStore = VoiceStateStore || findModule(['getVoiceStateForUser'], ['getVoiceStatesForChannel']);
    SelectedChannelStore = SelectedChannelStore || findModule(['getVoiceChannelId', 'getChannelId'], ['getVoiceChannelId']);
    VoiceActions = VoiceActions || findModule(['selectVoiceChannel', 'disconnect'], ['selectVoiceChannel']);

    const missing = Object.entries({ Dispatcher, UserStore, ChannelStore, VoiceStateStore, SelectedChannelStore, VoiceActions })
      .filter(([, mod]) => !mod)
      .map(([name]) => name);
    if (missing.length) console.log(`[${NAME}] modules introuvables : ${missing.join(', ')}`);
    return missing;
  }

  function toast(content, force) {
    if (!force && !getSetting('showToasts')) return;
    try {
      let source;
      for (const icon of ['ic_voice_channel_24px', 'Check']) {
        source = enmity.assets.getIDByName(icon);
        if (source) break;
      }
      Toasts.open(source ? { content, source } : { content });
    } catch (e) {
      console.log(`[${NAME}] toast impossible`, e);
    }
  }

  // Réponse visible seulement par toi (message de Clyde) dans le salon de la commande
  function reply(message, content) {
    const channelId = message && message.channel && message.channel.id;
    try {
      if (channelId && enmity.clyde) return enmity.clyde.sendReply(channelId, content);
    } catch (e) {
      console.log(`[${NAME}] réponse impossible`, e);
    }
    toast(content, true);
  }

  function getUserName(id) {
    const user = UserStore && UserStore.getUser(id);
    return user ? user.globalName || user.username : id;
  }

  function getUserVoiceChannel(id) {
    if (!id || !VoiceStateStore || typeof VoiceStateStore.getVoiceStateForUser !== 'function') return null;
    const state = VoiceStateStore.getVoiceStateForUser(id);
    return (state && state.channelId) || null;
  }

  function syncTargetChannel() {
    lastTargetChannel = getUserVoiceChannel(getSetting('targetId'));
  }

  function joinChannel(channelId) {
    const channel = ChannelStore.getChannel(channelId);
    if (!channel) {
      toast(`${getUserName(getSetting('targetId'))} est dans un salon inaccessible`);
      return;
    }
    // On sort du dispatch Flux en cours avant de déclencher une nouvelle action
    setTimeout(() => {
      try {
        VoiceActions.selectVoiceChannel(channelId);
        toast(`Suivi de ${getUserName(getSetting('targetId'))} → ${channel.name}`);
      } catch (e) {
        console.log(`[${NAME}] impossible de rejoindre le salon`, e);
      }
    }, 0);
  }

  function leaveVoice() {
    setTimeout(() => {
      try {
        if (typeof VoiceActions.disconnect === 'function') VoiceActions.disconnect();
        else VoiceActions.selectVoiceChannel(null);
      } catch (e) {
        console.log(`[${NAME}] impossible de quitter le vocal`, e);
      }
    }, 0);
  }

  function onVoiceStateUpdates(action) {
    try {
      const targetId = getSetting('targetId');
      if (!targetId) return;

      const me = UserStore.getCurrentUser();
      if (!me || me.id === targetId) return;

      const states = action.voiceStates || (action.userId ? [action] : []);
      for (const state of states) {
        if (state.userId !== targetId) continue;

        const prevChannel = state.oldChannelId !== undefined ? state.oldChannelId : lastTargetChannel;
        const newChannel = state.channelId || null;
        lastTargetChannel = newChannel;

        // Mute, sourdine, stream... : même salon, rien à faire
        if (newChannel === prevChannel) continue;

        const myChannel = SelectedChannelStore.getVoiceChannelId();

        if (newChannel) {
          if (newChannel === myChannel) continue;
          if (getSetting('onlyWhenInVoice') && !myChannel) continue;
          joinChannel(newChannel);
        } else if (getSetting('followLeave') && myChannel && myChannel === prevChannel) {
          leaveVoice();
          toast(`${getUserName(targetId)} a quitté le vocal, déconnexion`);
        }
      }
    } catch (e) {
      console.log(`[${NAME}] erreur VOICE_STATE_UPDATES`, e);
    }
  }

  // Renvoie le texte à afficher à l'utilisateur
  function follow(id) {
    const me = UserStore.getCurrentUser();
    if (me && me.id === id) return 'Tu ne peux pas te suivre toi-même.';

    setSetting('targetId', id);
    syncTargetChannel();

    const myChannel = SelectedChannelStore.getVoiceChannelId();
    if (getSetting('joinOnFollow') && lastTargetChannel && lastTargetChannel !== myChannel) {
      joinChannel(lastTargetChannel);
    }

    const where = lastTargetChannel ? 'Il est en vocal en ce moment.' : "Il n'est pas en vocal pour l'instant.";
    return `Tu suis maintenant **${getUserName(id)}**. ${where}`;
  }

  function unfollow() {
    const targetId = getSetting('targetId');
    setSetting('targetId', '');
    lastTargetChannel = null;
    return targetId ? `Tu ne suis plus **${getUserName(targetId)}**.` : 'Tu ne suivais personne.';
  }

  // Pas d'id, de type ni d'inputType : Enmity attribue lui-même ceux attendus par Discord
  const commands = [
    {
      name: 'follow',
      displayName: 'follow',
      description: 'Suivre automatiquement un utilisateur dans les salons vocaux',
      displayDescription: 'Suivre automatiquement un utilisateur dans les salons vocaux',
      options: [
        {
          name: 'user',
          displayName: 'user',
          description: "L'utilisateur à suivre",
          displayDescription: "L'utilisateur à suivre",
          type: OPTION_TYPE_USER,
          required: true,
        },
      ],
      execute(args, message) {
        const missing = loadModules();
        if (missing.length) return reply(message, `${NAME} ne marche pas sur cette version de Discord (introuvable : ${missing.join(', ')}).`);

        const arg = (args || []).find((a) => a.name === 'user');
        const id = arg ? String(arg.value).replace(/\D/g, '') : '';
        if (!id) return reply(message, 'Utilisateur invalide.');

        reply(message, follow(id));
      },
    },
    {
      name: 'unfollow',
      displayName: 'unfollow',
      description: "Arrêter de suivre l'utilisateur",
      displayDescription: "Arrêter de suivre l'utilisateur",
      options: [],
      execute(args, message) {
        loadModules();
        reply(message, unfollow());
      },
    },
  ];

  function SettingsPanel({ settings }) {
    const targetId = settings.get('targetId', DEFAULTS.targetId);

    const switchRow = (key, label, subLabel) =>
      h(FormRow, {
        label,
        subLabel,
        trailing: h(FormSwitch, {
          value: settings.get(key, DEFAULTS[key]),
          onValueChange: (value) => settings.set(key, value),
        }),
      });

    return h(
      ScrollView,
      null,
      h(
        FormSection,
        { title: 'Utilisateur suivi' },
        h(FormInput, {
          title: 'ID Discord',
          placeholder: '123456789012345678',
          keyboardType: 'numeric',
          value: targetId,
          onChange: (value) => {
            settings.set('targetId', String(value).replace(/\D/g, ''));
            syncTargetChannel();
          },
        }),
        h(FormRow, {
          label: targetId ? `Suivi : ${getUserName(targetId)}` : "Personne n'est suivi",
          subLabel: targetId ? 'Appuie pour arrêter de suivre' : 'Utilise /follow ou entre un ID ci-dessus',
          onPress: targetId ? () => toast(unfollow(), true) : undefined,
        })
      ),
      h(
        FormSection,
        { title: 'Options' },
        switchRow('joinOnFollow', 'Rejoindre immédiatement', 'Rejoint son salon dès que tu commences à le suivre'),
        h(FormDivider),
        switchRow('followLeave', 'Suivre les déconnexions', 'Quitte le vocal quand il quitte ton salon'),
        h(FormDivider),
        switchRow('onlyWhenInVoice', 'Seulement si je suis en vocal', 'Ne le suit que si tu es déjà dans un salon vocal'),
        h(FormDivider),
        switchRow('showToasts', 'Notifications', 'Affiche un toast à chaque action')
      )
    );
  }

  const FollowUser = {
    name: NAME,
    version: '1.0.1',
    description: 'Suit automatiquement un utilisateur dans les salons vocaux.',
    authors: [{ name: 'NANODLAPISCINE', id: '000000000000000000' }], // remplace par ton ID Discord
    color: '#5865F2',

    onStart() {
      // En premier, pour que les commandes apparaissent même si la suite échoue.
      // Une commande par appel : Enmity donne alors un id distinct à chacune.
      for (const command of commands) enmity.commands.registerCommands(NAME, [command]);

      try {
        const missing = loadModules();
        if (missing.length) {
          toast(`${NAME} : version de Discord non supportée (${missing.join(', ')})`, true);
          return;
        }

        syncTargetChannel();
        Dispatcher.subscribe('VOICE_STATE_UPDATES', onVoiceStateUpdates);
        subscribed = true;
      } catch (e) {
        console.log(`[${NAME}] erreur au démarrage`, e);
        toast(`${NAME} : erreur au démarrage (${e.message})`, true);
      }
    },

    onStop() {
      enmity.commands.unregisterCommands(NAME);
      if (subscribed) Dispatcher.unsubscribe('VOICE_STATE_UPDATES', onVoiceStateUpdates);
      subscribed = false;
      lastTargetChannel = null;
    },

    getSettingsPanel({ settings }) {
      return h(SettingsPanel, { settings });
    },
  };

  enmity.plugins.registerPlugin(FollowUser);
})();
