'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Loader2, Plus, X } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import type { MessageTemplate } from '@/types';

const CATEGORIES = ['Marketing', 'Utility', 'Authentication'] as const;
const HEADER_TYPES = ['none', 'text', 'image', 'video', 'document'] as const;
const LANGUAGE_CODES = ['en_US', 'en_GB', 'en', 'hi_IN', 'es', 'fr', 'de', 'pt_BR'] as const;

type CtaButton = {
  type: 'url' | 'phone';
  text: string;
  value: string;
};

type FormState = {
  name: string;
  category: MessageTemplate['category'];
  language: string;
  header_type: (typeof HEADER_TYPES)[number];
  header_content: string;
  body_text: string;
  footer_text: string;
  cta_buttons: CtaButton[];
};

const initialForm: FormState = {
  name: '',
  category: 'Marketing',
  language: 'en_US',
  header_type: 'none',
  header_content: '',
  body_text: '',
  footer_text: '',
  cta_buttons: [],
};

export function TemplateCreateForm() {
  const router = useRouter();
  const [form, setForm] = useState<FormState>(initialForm);
  const [saving, setSaving] = useState(false);

  const previewBody = useMemo(() => {
    return form.body_text.trim() || 'Your message preview will appear here.';
  }, [form.body_text]);

  function addCtaButton() {
    if (form.cta_buttons.length >= 2) {
      toast.error('You can add up to 2 CTA buttons');
      return;
    }
    setForm((prev) => ({
      ...prev,
      cta_buttons: [...prev.cta_buttons, { type: 'url', text: '', value: '' }],
    }));
  }

  function patchCta(index: number, patch: Partial<CtaButton>) {
    setForm((prev) => ({
      ...prev,
      cta_buttons: prev.cta_buttons.map((btn, i) => (i === index ? { ...btn, ...patch } : btn)),
    }));
  }

  function removeCta(index: number) {
    setForm((prev) => ({
      ...prev,
      cta_buttons: prev.cta_buttons.filter((_, i) => i !== index),
    }));
  }

  async function handleCreate() {
    if (!form.name.trim()) return toast.error('Template name is required');
    if (!form.body_text.trim()) return toast.error('Body text is required');

    const firstCta = form.cta_buttons[0];
    if (firstCta && (!firstCta.text.trim() || !firstCta.value.trim())) {
      return toast.error('CTA button text and value are required');
    }

    setSaving(true);
    try {
      const res = await fetch('/api/whatsapp/templates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: form.name.trim(),
          category: form.category,
          language: form.language.trim() || 'en_US',
          body_text: form.body_text.trim(),
          header_type: form.header_type === 'none' ? null : form.header_type,
          header_content: form.header_content.trim() || null,
          footer_text: form.footer_text.trim() || null,
          cta_button: firstCta
            ? {
                type: firstCta.type,
                text: firstCta.text.trim(),
                value: firstCta.value.trim(),
              }
            : null,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || `Create failed (HTTP ${res.status})`);
      toast.success(data.message || 'Template submitted to Meta');
      router.push('/template-manager');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to create template');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
      <div className="space-y-4">
        <Card className="border-slate-700 bg-slate-900">
          <CardHeader className="pb-3">
            <CardTitle className="text-base text-white">Template name and language</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-2 sm:col-span-1">
              <Label className="text-slate-300">Template name</Label>
              <Input
                value={form.name}
                onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
                placeholder="e.g. order_confirmation"
                className="border-slate-700 bg-slate-800 text-white"
              />
            </div>
            <div className="space-y-2 sm:col-span-1">
              <Label className="text-slate-300">Language</Label>
              <Input
                list="template-language-options"
                value={form.language}
                onChange={(e) => setForm((p) => ({ ...p, language: e.target.value }))}
                className="border-slate-700 bg-slate-800 text-white"
              />
              <datalist id="template-language-options">
                {LANGUAGE_CODES.map((code) => (
                  <option key={code} value={code} />
                ))}
              </datalist>
            </div>
            <div className="space-y-2 sm:col-span-2">
              <Label className="text-slate-300">Category</Label>
              <Select
                value={form.category}
                onValueChange={(value) => setForm((p) => ({ ...p, category: value as MessageTemplate['category'] }))}
              >
                <SelectTrigger className="border-slate-700 bg-slate-800 text-white">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="border-slate-700 bg-slate-800">
                  {CATEGORIES.map((cat) => (
                    <SelectItem key={cat} value={cat} className="text-white focus:bg-slate-700 focus:text-white">
                      {cat}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </CardContent>
        </Card>

        <Card className="border-slate-700 bg-slate-900">
          <CardHeader className="pb-3">
            <CardTitle className="text-base text-white">Content</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label className="text-slate-300">Header type</Label>
              <Select
                value={form.header_type}
                onValueChange={(value) => setForm((p) => ({ ...p, header_type: value as FormState['header_type'] }))}
              >
                <SelectTrigger className="border-slate-700 bg-slate-800 text-white">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="border-slate-700 bg-slate-800">
                  {HEADER_TYPES.map((type) => (
                    <SelectItem key={type} value={type} className="text-white focus:bg-slate-700 focus:text-white">
                      {type === 'none' ? 'None' : type.charAt(0).toUpperCase() + type.slice(1)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {form.header_type !== 'none' && form.header_type !== 'text' && (
                <p className="text-xs text-amber-400">
                  Media headers must currently be finalized in Meta Manager. You can still create the template here.
                </p>
              )}
            </div>

            {form.header_type === 'text' && (
              <div className="space-y-2">
                <Label className="text-slate-300">Header text</Label>
                <Input
                  value={form.header_content}
                  onChange={(e) => setForm((p) => ({ ...p, header_content: e.target.value }))}
                  className="border-slate-700 bg-slate-800 text-white"
                />
              </div>
            )}

            <div className="space-y-2">
              <Label className="text-slate-300">Body</Label>
              <Textarea
                value={form.body_text}
                onChange={(e) => setForm((p) => ({ ...p, body_text: e.target.value }))}
                placeholder="Hello {{1}}"
                rows={6}
                className="resize-none border-slate-700 bg-slate-800 text-white"
              />
            </div>

            <div className="space-y-2">
              <Label className="text-slate-300">Footer (optional)</Label>
              <Input
                value={form.footer_text}
                onChange={(e) => setForm((p) => ({ ...p, footer_text: e.target.value }))}
                className="border-slate-700 bg-slate-800 text-white"
              />
            </div>
          </CardContent>
        </Card>

        <Card className="border-slate-700 bg-slate-900">
          <CardHeader className="pb-3">
            <CardTitle className="text-base text-white">Buttons (CTA)</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {form.cta_buttons.map((btn, index) => (
              <div key={index} className="rounded-lg border border-slate-700 bg-slate-800/60 p-3">
                <div className="mb-2 flex items-center justify-between">
                  <p className="text-xs font-medium text-slate-300">CTA #{index + 1}</p>
                  <Button type="button" variant="ghost" size="icon-sm" onClick={() => removeCta(index)}>
                    <X className="size-4" />
                  </Button>
                </div>
                <div className="grid gap-2 sm:grid-cols-3">
                  <Select value={btn.type} onValueChange={(v) => patchCta(index, { type: v as 'url' | 'phone' })}>
                    <SelectTrigger className="border-slate-700 bg-slate-800 text-white">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="border-slate-700 bg-slate-800">
                      <SelectItem value="url" className="text-white">Visit website</SelectItem>
                      <SelectItem value="phone" className="text-white">Call phone</SelectItem>
                    </SelectContent>
                  </Select>
                  <Input
                    placeholder="Button text"
                    value={btn.text}
                    onChange={(e) => patchCta(index, { text: e.target.value })}
                    className="border-slate-700 bg-slate-800 text-white"
                  />
                  <Input
                    placeholder={btn.type === 'url' ? 'https://example.com' : '+911234567890'}
                    value={btn.value}
                    onChange={(e) => patchCta(index, { value: e.target.value })}
                    className="border-slate-700 bg-slate-800 text-white"
                  />
                </div>
              </div>
            ))}
            <Button type="button" variant="outline" onClick={addCtaButton} className="border-slate-700 text-slate-300">
              <Plus className="size-4" />
              Add CTA button
            </Button>
            <p className="text-xs text-slate-500">Current API submits 1 CTA button to Meta (first item).</p>
          </CardContent>
        </Card>

        <div className="flex items-center justify-between">
          <Button variant="outline" onClick={() => router.push('/template-manager')} className="border-slate-700 text-slate-300">
            <ArrowLeft className="size-4" />
            Back to Template Manager
          </Button>
          <Button onClick={handleCreate} disabled={saving} className="bg-violet-600 text-white hover:bg-violet-700">
            {saving ? <Loader2 className="size-4 animate-spin" /> : null}
            Create on Meta
          </Button>
        </div>
      </div>

      <Card className="h-fit border-slate-700 bg-slate-900">
        <CardHeader className="pb-3">
          <CardTitle className="text-base text-white">Template preview</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="rounded-xl bg-[#1f2c34] p-3">
            {form.header_type === 'text' && form.header_content.trim() ? (
              <p className="mb-2 text-xs font-semibold text-slate-300">{form.header_content.trim()}</p>
            ) : null}
            <div className="rounded-lg bg-[#202c33] p-2 text-sm text-slate-100">
              {previewBody}
            </div>
            {form.footer_text.trim() ? (
              <p className="mt-2 text-[11px] text-slate-400">{form.footer_text.trim()}</p>
            ) : null}
            {form.cta_buttons[0]?.text?.trim() ? (
              <button type="button" className="mt-3 w-full rounded-md border border-slate-600 px-2 py-1.5 text-xs font-medium text-violet-300">
                {form.cta_buttons[0].text.trim()}
              </button>
            ) : null}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
