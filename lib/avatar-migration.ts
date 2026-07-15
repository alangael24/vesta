type AvatarState = {
  avatarKey?: string | null;
  avatarVersion?: string | null;
  avatarUpdatedAt?: string | null;
} | null | undefined;

// Opaque account id for the one-time private avatar migration. No email is shipped.
const legacyAvatarOwnerId = "usr_4c0a265c0937ec8b834616cc";

export function needsLegacyAvatarRestore(ownerId: string, avatar: AvatarState) {
  return ownerId === legacyAvatarOwnerId
    && !avatar?.avatarKey
    && !avatar?.avatarVersion
    && !avatar?.avatarUpdatedAt;
}
