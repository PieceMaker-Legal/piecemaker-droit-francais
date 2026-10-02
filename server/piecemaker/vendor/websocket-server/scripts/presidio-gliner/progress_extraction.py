from gliner2.inference.chunking import merge_chunk_results, split_text_into_chunks
from gliner2.processing.word_splitter import word_splitter_from

CHUNK_SIZE = 384
CHUNK_OVERLAP = 64
BATCH_SIZE = 8


def extract_entities_with_progress(model, text, labels, threshold, on_progress=None):
    chunks = split_text_into_chunks(
        text,
        chunk_size=CHUNK_SIZE,
        chunk_overlap=CHUNK_OVERLAP,
        word_splitter=word_splitter_from(model),
    )
    schema = model.create_schema().entities(labels)
    chunk_results = []
    for batch_start in range(0, len(chunks), BATCH_SIZE):
        batch = chunks[batch_start:batch_start + BATCH_SIZE]
        chunk_results.extend(model.batch_extract(
            [chunk.text for chunk in batch],
            [schema] * len(batch),
            batch_size=BATCH_SIZE,
            threshold=threshold,
            num_workers=0,
            format_results=True,
            include_confidence=True,
            include_spans=True,
            max_len=CHUNK_SIZE,
        ))
        if on_progress:
            on_progress(batch_start + len(batch), len(chunks))
    return merge_chunk_results(
        text,
        chunks,
        chunk_results,
        include_confidence=True,
        include_spans=True,
    )
