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

  const { React, FluxDispatcher, Toasts } = enmity.modules.common;
  const { FormRow, FormSwitch, FormInput, FormSection, FormDivider, ScrollView } = enmity.components;
  const h = React.createElement;

  // Valeurs des enums de l'API Discord utilisées par les commandes Enmity
  const ApplicationCommandType = { Chat: 1 };
  const ApplicationCommandInputType = { BuiltInText: 1 };
  const ApplicationCommandOptionType = { User: 6 };

  const DEFAULTS = {
    targetId: '',
    joinOnFollow: true,
    followLeave: false,
    onlyWhenInVoice: false,
    showToasts: true,
  };

  const getSetting = (key) => enmity.settings.get(NAME, key, DEFAULTS[key]);
  const setSetting = (key, value) => enmity.settings.set(NAME, key, value);

  let UserStore, ChannelStore, VoiceStateStore, SelectedChannelStore, VoiceActions;
  let lastTargetChannel = null;

  // Essaie plusieurs combinaisons de props, au cas où Discord renomme un module
  function findModule(...candidates) {
    for (const props of candidates) {
      const mod = enmity.modules.getByProps(...props);
      if (mod) return mod;
    }
    return null;
  }

  function toast(content) {
    if (!getSetting('showToasts')) return;
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

  function follow(id) {
    const me = UserStore.getCurrentUser();
    if (me && me.id === id) {
      toast('Tu ne peux pas te suivre toi-même');
      return;
    }

    setSetting('targetId', id);
    syncTargetChannel();
    toast(`Tu suis maintenant ${getUserName(id)}`);

    if (getSetting('joinOnFollow') && lastTargetChannel && lastTargetChannel !== SelectedChannelStore.getVoiceChannelId()) {
      joinChannel(lastTargetChannel);
    }
  }

  function unfollow() {
    const targetId = getSetting('targetId');
    setSetting('targetId', '');
    lastTargetChannel = null;
    toast(targetId ? `Tu ne suis plus ${getUserName(targetId)}` : 'Tu ne suivais personne');
  }

  const commands = [
    {
      id: 'followuser-follow',
      name: 'follow',
      displayName: 'follow',
      description: 'Suivre automatiquement un utilisateur dans les salons vocaux',
      displayDescription: 'Suivre automatiquement un utilisateur dans les salons vocaux',
      type: ApplicationCommandType.Chat,
      inputType: ApplicationCommandInputType.BuiltInText,
      options: [
        {
          name: 'user',
          displayName: 'user',
          description: "L'utilisateur à suivre",
          displayDescription: "L'utilisateur à suivre",
          type: ApplicationCommandOptionType.User,
          required: true,
        },
      ],
      execute(args) {
        const arg = (args || []).find((a) => a.name === 'user');
        const id = arg ? String(arg.value).replace(/\D/g, '') : '';
        if (!id) {
          toast('Utilisateur invalide');
          return;
        }
        follow(id);
      },
    },
    {
      id: 'followuser-unfollow',
      name: 'unfollow',
      displayName: 'unfollow',
      description: "Arrêter de suivre l'utilisateur",
      displayDescription: "Arrêter de suivre l'utilisateur",
      type: ApplicationCommandType.Chat,
      inputType: ApplicationCommandInputType.BuiltInText,
      options: [],
      execute() {
        unfollow();
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
          onPress: targetId ? unfollow : undefined,
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
    version: '1.0.0',
    description: 'Suit automatiquement un utilisateur dans les salons vocaux.',
    authors: [{ name: 'NANODLAPISCINE', id: '000000000000000000' }], // remplace par ton ID Discord
    color: '#5865F2',

    onStart() {
      UserStore = findModule(['getCurrentUser', 'getUser']);
      ChannelStore = findModule(['getChannel', 'getDMFromUserId'], ['getChannel']);
      VoiceStateStore = findModule(['getVoiceStateForUser'], ['getVoiceStatesForChannel']);
      SelectedChannelStore = findModule(['getVoiceChannelId', 'getChannelId'], ['getVoiceChannelId']);
      VoiceActions = findModule(['selectVoiceChannel', 'disconnect'], ['selectVoiceChannel']);

      if (!UserStore || !ChannelStore || !VoiceStateStore || !SelectedChannelStore || !VoiceActions) {
        console.log(`[${NAME}] modules Discord introuvables, plugin désactivé`);
        toast(`${NAME} : version de Discord non supportée`);
        return;
      }

      syncTargetChannel();
      FluxDispatcher.subscribe('VOICE_STATE_UPDATES', onVoiceStateUpdates);
      enmity.commands.registerCommands(NAME, commands);
    },

    onStop() {
      FluxDispatcher.unsubscribe('VOICE_STATE_UPDATES', onVoiceStateUpdates);
      enmity.commands.unregisterCommands(NAME);
      lastTargetChannel = null;
    },

    getSettingsPanel({ settings }) {
      return h(SettingsPanel, { settings });
    },
  };

  enmity.plugins.registerPlugin(FollowUser);
})();
