<script setup lang="ts">
import { reactive } from 'vue';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';

// Phase 1 scope: visual shell only. Real tenant-scoped JWT auth arrives in Phase 5.
const form = reactive({ email: '', password: '' });

function onSubmit(): void {
  // no-op until Phase 5 wires up /api/auth/login
}
</script>

<template>
  <main class="flex min-h-screen items-center justify-center bg-muted/40 p-6">
    <Card class="w-full max-w-sm">
      <CardHeader class="items-center text-center">
        <div
          class="mb-2 grid size-14 place-items-center rounded-2xl bg-gradient-to-br from-blue-600 to-violet-600 text-xl font-bold text-white"
        >
          DF
        </div>
        <CardTitle class="text-2xl">DealFlow360</CardTitle>
        <CardDescription>Sales Workspace — sign in to your organization</CardDescription>
      </CardHeader>

      <CardContent>
        <form class="grid gap-4" @submit.prevent="onSubmit">
          <div class="grid gap-2">
            <Label for="email">Email</Label>
            <Input
              id="email"
              v-model="form.email"
              type="email"
              placeholder="you@your-org.com"
              autocomplete="username"
            />
          </div>
          <div class="grid gap-2">
            <Label for="password">Password</Label>
            <Input
              id="password"
              v-model="form.password"
              type="password"
              placeholder="••••••••"
              autocomplete="current-password"
            />
          </div>
          <Button type="submit" class="w-full">Sign in</Button>
        </form>
      </CardContent>

      <CardFooter class="justify-center">
        <p class="text-xs text-muted-foreground">
          Authentication is wired up in Phase 5 — this is the shell.
        </p>
      </CardFooter>
    </Card>
  </main>
</template>
