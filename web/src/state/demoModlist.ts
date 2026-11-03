import { ParsedWabbajackFile } from '../types/wabbajack';

// Built-in Demo Modlist (Skyrim Modding Essentials / SME) for instant testing
export const PHOENIX_DEMO_MODLIST: ParsedWabbajackFile = {
  name: 'Skyrim Modding Essentials (SME)',
  author: 'Phoenix & The Animonculory',
  // Description en anglais : langue source du service de traduction (useTranslated)
  description: 'A minimal, clean and high-performance base for Skyrim Special Edition / Anniversary Edition including SKSE, SkyUI, Bug Fixes, Address Library and Engine Fixes.',
  version: '3.4.1',
  gameType: 'SkyrimSpecialEdition',
  totalArchiveSize: 1773875760,
  totalInstalledSize: 5800000000,
  numberOfArchives: 8,
  numberOfDirectives: 1840,
  inlinedFilesCount: 42,
  patchesCount: 8,
  loadOrder: [
    'Skyrim.esm',
    'Update.esm',
    'Dawnguard.esm',
    'HearthFires.esm',
    'Dragonborn.esm',
    'Unofficial Skyrim Special Edition Patch.esp',
    'SkyUI_SE.esp',
    'SMIM-SE-Merged-All.esp',
    'Skyrim Priority.esp',
  ],
  pluginsTxt: `*Skyrim.esm
*Update.esm
*Dawnguard.esm
*HearthFires.esm
*Dragonborn.esm
*Unofficial Skyrim Special Edition Patch.esp
*SkyUI_SE.esp
*SMIM-SE-Merged-All.esp
*Skyrim Priority.esp`,
  archives: [
    {
      Hash: 'a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2',
      Name: 'SkyUI_5_2_SE.7z',
      Size: 20485760,
      State: {
        GameName: 'skyrimspecialedition',
        ModID: 12604,
        FileID: 35407,
        Author: 'SkyUI Team',
        Version: '5.2SE',
      },
      status: 'ready',
    },
    {
      Hash: 'f1e2d3c4b5a697887766554433221100',
      Name: 'Unofficial Skyrim Special Edition Patch-266-4-2-9a.7z',
      Size: 624500000,
      State: {
        GameName: 'skyrimspecialedition',
        ModID: 266,
        FileID: 135890,
        Author: 'Arthmoor',
        Version: '4.2.9a',
      },
      status: 'ready',
    },
    {
      Hash: '00112233445566778899aabbccddeeff',
      Name: 'SKSE64_2_02_06.7z',
      Size: 1850000,
      State: {
        Url: 'https://skse.silverlock.org/beta/skse64_2_02_06.7z',
        Author: 'Ian Patterson',
        Version: '2.2.6',
      },
      status: 'ready',
    },
    {
      Hash: 'aabbccddeeff00112233445566778899',
      Name: 'Address Library for SKSE Plugins-32444-8-1-6-640.zip',
      Size: 850000,
      State: {
        GameName: 'skyrimspecialedition',
        ModID: 32444,
        FileID: 148560,
        Author: 'meh321',
        Version: '8',
      },
      status: 'ready',
    },
    {
      Hash: 'cafebabe00112233445566778899aabb',
      Name: 'SSE Engine Fixes (skse64 plugin)-17230-6-1-1.zip',
      Size: 4200000,
      State: {
        GameName: 'skyrimspecialedition',
        ModID: 17230,
        FileID: 75432,
        Author: 'aers',
        Version: '6.1.1',
      },
      status: 'missing',
    },
    {
      Hash: 'deadbeef1234567890abcdef12345678',
      Name: 'Static Mesh Improvement Mod - SMIM-659-2-08.7z',
      Size: 1120000000,
      State: {
        GameName: 'skyrimspecialedition',
        ModID: 659,
        FileID: 24510,
        Author: 'Brumbek',
        Version: '2.08',
      },
      status: 'ready',
    },
    {
      Hash: '1234567890abcdef1234567890abcdef',
      Name: 'SSE Display Tweaks-34705-0-5-12b.zip',
      Size: 1540000,
      State: {
        GameName: 'skyrimspecialedition',
        ModID: 34705,
        FileID: 124300,
        Author: 'SlavicPotato',
        Version: '0.5.12b',
      },
      status: 'missing',
    },
    {
      Hash: 'fedcba0987654321fedcba0987654321',
      Name: 'Skyrim Priority SE-AE - CPU Performance-50502-3-4-0.zip',
      Size: 450000,
      State: {
        GameName: 'skyrimspecialedition',
        ModID: 50502,
        FileID: 98760,
        Author: 'Boring3',
        Version: '3.4.0',
      },
      status: 'ready',
    },
  ],
  directives: [
    {
      $type: 'FromArchive',
      To: 'mods/SkyUI_SE/SkyUI_SE.esp',
      Size: 1450000,
      Hash: 'skyui_esp_hash',
      ArchiveHash: 'a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2',
      SourcePath: 'SkyUI_SE.esp',
    },
    {
      $type: 'FromArchive',
      To: 'mods/SkyUI_SE/SkyUI_SE.bsa',
      Size: 18500000,
      Hash: 'skyui_bsa_hash',
      ArchiveHash: 'a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2',
      SourcePath: 'SkyUI_SE.bsa',
    },
    {
      $type: 'FromArchive',
      To: 'mods/Unofficial Skyrim Special Edition Patch/Unofficial Skyrim Special Edition Patch.esp',
      Size: 32500000,
      Hash: 'ussep_esp_hash',
      ArchiveHash: 'f1e2d3c4b5a697887766554433221100',
      SourcePath: 'Unofficial Skyrim Special Edition Patch.esp',
    },
    {
      $type: 'InlineFile',
      To: 'profiles/Default/modlist.txt',
      Size: 1240,
      Hash: 'inlined_modlist_txt',
    },
    {
      $type: 'InlineFile',
      To: 'profiles/Default/plugins.txt',
      Size: 850,
      Hash: 'inlined_plugins_txt',
    },
    {
      $type: 'PatchedFromArchive',
      To: 'mods/Engine Fixes/skse/plugins/EngineFixes.toml',
      Size: 12800,
      Hash: 'patched_toml_hash',
      ArchiveHash: 'cafebabe00112233445566778899aabb',
      PatchID: 'patch_engine_fixes_toml',
    },
  ],
};
