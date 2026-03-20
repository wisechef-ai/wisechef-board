#!/usr/bin/env python3
"""
Cognee MCP Server for WiseChef
Exposes Cognee knowledge graph as stdio MCP tools for OpenClaw agents.
"""

import asyncio
import json
import os
import sys
from pathlib import Path
from datetime import datetime

# Load environment
from dotenv import load_dotenv
load_dotenv(Path(__file__).parent / '.env')

import cognee
from cognee.api.v1.search import SearchType


async def handle_search(params):
    """Search the knowledge graph."""
    query = params.get('query', '')
    search_type = params.get('search_type', 'GRAPH_COMPLETION')
    
    type_map = {
        'GRAPH_COMPLETION': SearchType.GRAPH_COMPLETION,
        'SIMILARITY': SearchType.SIMILARITY,
        'TEMPORAL': SearchType.TEMPORAL,
    }
    
    st = type_map.get(search_type.upper(), SearchType.GRAPH_COMPLETION)
    results = await cognee.search(query, search_type=st)
    
    return {'results': [str(r) for r in results] if results else []}


async def handle_save_interaction(params):
    """Save data to the knowledge graph."""
    data = params.get('data', '')
    if not data:
        return {'error': 'data is required'}
    
    timestamp = datetime.now().isoformat()
    text = f"[{timestamp}] {data}"
    
    await cognee.add(text, dataset_name='interactions')
    await cognee.cognify()
    
    return {'saved': True, 'timestamp': timestamp}


async def handle_ingest(params):
    """Ingest a file into the knowledge graph."""
    file_path = params.get('file_path', '')
    if not file_path or not Path(file_path).exists():
        return {'error': f'File not found: {file_path}'}
    
    content = Path(file_path).read_text(errors='replace')
    dataset_name = params.get('dataset', 'files')
    
    await cognee.add(content, dataset_name=dataset_name)
    await cognee.cognify()
    
    return {'ingested': True, 'file': file_path, 'chars': len(content)}


async def handle_stats(params):
    """Return knowledge graph statistics."""
    try:
        from cognee.infrastructure.databases.graph import get_graph_engine
        graph = await get_graph_engine()
        nodes = await graph.get_nodes()
        edges = await graph.get_edges()
        return {
            'nodes': len(nodes) if nodes else 0,
            'edges': len(edges) if edges else 0,
        }
    except Exception as e:
        return {'error': str(e)}


# MCP stdio protocol handler
TOOLS = {
    'cognee.search': {
        'description': 'Search the knowledge graph for information',
        'inputSchema': {
            'type': 'object',
            'properties': {
                'query': {'type': 'string', 'description': 'Search query'},
                'search_type': {'type': 'string', 'enum': ['GRAPH_COMPLETION', 'SIMILARITY', 'TEMPORAL'], 'default': 'GRAPH_COMPLETION'},
            },
            'required': ['query'],
        },
        'handler': handle_search,
    },
    'cognee.save_interaction': {
        'description': 'Save facts or interaction data to the knowledge graph',
        'inputSchema': {
            'type': 'object',
            'properties': {
                'data': {'type': 'string', 'description': 'Data to save'},
            },
            'required': ['data'],
        },
        'handler': handle_save_interaction,
    },
    'cognee.ingest': {
        'description': 'Ingest a file into the knowledge graph',
        'inputSchema': {
            'type': 'object',
            'properties': {
                'file_path': {'type': 'string', 'description': 'Path to file to ingest'},
                'dataset': {'type': 'string', 'description': 'Dataset name', 'default': 'files'},
            },
            'required': ['file_path'],
        },
        'handler': handle_ingest,
    },
    'cognee.stats': {
        'description': 'Get knowledge graph statistics (node/edge counts)',
        'inputSchema': {
            'type': 'object',
            'properties': {},
        },
        'handler': handle_stats,
    },
}


async def process_request(request):
    """Process a JSON-RPC request."""
    method = request.get('method', '')
    params = request.get('params', {})
    req_id = request.get('id')
    
    if method == 'initialize':
        return {
            'jsonrpc': '2.0',
            'id': req_id,
            'result': {
                'protocolVersion': '2024-11-05',
                'serverInfo': {'name': 'cognee-wisechef', 'version': '26.04.0'},
                'capabilities': {'tools': {}},
            },
        }
    
    if method == 'tools/list':
        tools = []
        for name, tool in TOOLS.items():
            tools.append({
                'name': name,
                'description': tool['description'],
                'inputSchema': tool['inputSchema'],
            })
        return {'jsonrpc': '2.0', 'id': req_id, 'result': {'tools': tools}}
    
    if method == 'tools/call':
        tool_name = params.get('name', '')
        tool_args = params.get('arguments', {})
        
        if tool_name not in TOOLS:
            return {
                'jsonrpc': '2.0', 'id': req_id,
                'error': {'code': -32601, 'message': f'Unknown tool: {tool_name}'},
            }
        
        try:
            result = await TOOLS[tool_name]['handler'](tool_args)
            return {
                'jsonrpc': '2.0', 'id': req_id,
                'result': {'content': [{'type': 'text', 'text': json.dumps(result, default=str)}]},
            }
        except Exception as e:
            return {
                'jsonrpc': '2.0', 'id': req_id,
                'result': {'content': [{'type': 'text', 'text': json.dumps({'error': str(e)})}], 'isError': True},
            }
    
    if method == 'notifications/initialized':
        return None  # No response for notifications
    
    return {
        'jsonrpc': '2.0', 'id': req_id,
        'error': {'code': -32601, 'message': f'Method not found: {method}'},
    }


async def main():
    """Run the MCP stdio server."""
    reader = asyncio.StreamReader()
    protocol = asyncio.StreamReaderProtocol(reader)
    await asyncio.get_event_loop().connect_read_pipe(lambda: protocol, sys.stdin)
    
    writer_transport, writer_protocol = await asyncio.get_event_loop().connect_write_pipe(
        asyncio.streams.FlowControlMixin, sys.stdout
    )
    writer = asyncio.StreamWriter(writer_transport, writer_protocol, None, asyncio.get_event_loop())
    
    buffer = b''
    while True:
        try:
            chunk = await reader.read(8192)
            if not chunk:
                break
            buffer += chunk
            
            # Process complete messages (newline-delimited JSON)
            while b'\n' in buffer:
                line, buffer = buffer.split(b'\n', 1)
                line = line.strip()
                if not line:
                    continue
                
                try:
                    request = json.loads(line)
                    response = await process_request(request)
                    if response is not None:
                        writer.write(json.dumps(response).encode() + b'\n')
                        await writer.drain()
                except json.JSONDecodeError:
                    pass
        except Exception:
            break


if __name__ == '__main__':
    asyncio.run(main())
