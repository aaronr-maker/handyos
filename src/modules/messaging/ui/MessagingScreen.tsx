import { ModulePlaceholder } from '@/core';

export default function MessagingScreen() {
  return (
    <ModulePlaceholder
      title="Messages"
      icon="messaging"
      summary="Talk to customers without leaving the app."
      planned={['Two-way text and email threads', 'On-my-way and reminder templates', 'AI-drafted replies you approve']}
    />
  );
}
