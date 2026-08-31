<template>
  <div>
    <h1>{{ $t('user.name') }}</h1>
    <p v-t="'user.email'"></p>
    <i18n-t keypath="user.deleteConfirm" tag="span" />
    <button :title="$t('common.save')">{{ t('common.ok') }}</button>
  </div>
</template>

<script setup lang="ts">
import { useI18n } from 'vue-i18n';
const { t } = useI18n();

function onDelete(): void {
  window.alert(t('user.deleteSuccess'));
}
</script>
