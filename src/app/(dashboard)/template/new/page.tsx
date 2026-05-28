'use client';

import { TemplateCreateForm } from '@/components/settings/template-create-form';

export default function NewTemplatePage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">Create Template</h1>
        <p className="mt-1 text-sm text-slate-400">
          Build and submit WhatsApp templates without leaving the CRM.
        </p>
      </div>
      <TemplateCreateForm />
    </div>
  );
}
