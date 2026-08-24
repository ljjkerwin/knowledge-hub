'use client';
import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import { DocumentEditor } from '@/components/documents/document-editor';
import { documentService } from '@/services/document.service';
import { KnowledgeDocument } from '@/types/api.types';
export default function EditDocumentPage() { const { id } = useParams<{ id: string }>(); const [doc, setDoc] = useState<KnowledgeDocument>(); const [error, setError] = useState(''); useEffect(() => { void documentService.get(id).then(setDoc).catch((e: Error) => setError(e.message)); }, [id]); if (error) return <div className="p-6 text-destructive">{error}</div>; return doc ? <DocumentEditor initialDocument={doc} /> : <div className="flex h-full items-center justify-center"><Loader2 className="animate-spin" /></div>; }
