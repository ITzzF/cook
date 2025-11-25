import os
import sys
from pathlib import Path
from flask import Flask, render_template, request, jsonify, Response, stream_with_context
import json
import logging

# 添加模块路径
sys.path.append(str(Path(__file__).parent))

from main import RecipeRAGSystem
from rag_modules import DataPreparationModule

# 配置日志
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = Flask(__name__)

# 全局 RAG 系统实例
rag_system = None

def get_rag_system():
    global rag_system
    return rag_system

@app.route('/')
def index():
    return render_template('index.html')

@app.route('/api/init', methods=['POST'])
def init_system():
    global rag_system
    try:
        if rag_system is None:
            rag_system = RecipeRAGSystem()
            rag_system.initialize_system()
            rag_system.build_knowledge_base()
            return jsonify({"status": "success", "message": "系统初始化完成"})
        else:
             return jsonify({"status": "success", "message": "系统已就绪"})
    except Exception as e:
        logger.error(f"初始化失败: {e}")
        return jsonify({"status": "error", "message": str(e)}), 500

@app.route('/api/chat', methods=['POST'])
def chat():
    global rag_system
    if not rag_system:
        return jsonify({"status": "error", "message": "请先启动系统"}), 400

    data = request.json
    query = data.get('query')
    stream = data.get('stream', True)

    if not query:
        return jsonify({"status": "error", "message": "请输入问题"}), 400

    try:
        # 1. 查询路由
        route_type = rag_system.generation_module.query_router(query)
        
        # 2. 查询重写
        rewritten_query = query
        if route_type != 'list':
            rewritten_query = rag_system.generation_module.query_rewrite(query)
        
        # 3. 检索
        filters = rag_system._extract_filters_from_query(query)
        if filters:
            relevant_chunks = rag_system.retrieval_module.metadata_filtered_search(
                rewritten_query, filters, top_k=rag_system.config.top_k
            )
        else:
            relevant_chunks = rag_system.retrieval_module.hybrid_search(
                rewritten_query, top_k=rag_system.config.top_k
            )
        
        # 准备源文档信息
        source_info = []
        for chunk in relevant_chunks:
            source_info.append({
                "dish_name": chunk.metadata.get('dish_name', '未知'),
                "category": chunk.metadata.get('category', '未知'),
                "difficulty": chunk.metadata.get('difficulty', '未知'),
                "content": chunk.page_content[:100].replace('\n', ' ')
            })

        if not relevant_chunks:
            return jsonify({
                "status": "success",
                "answer": "抱歉，没有找到相关的食谱信息。请尝试其他菜品名称或关键词。",
                "sources": []
            })

        relevant_docs = rag_system.data_module.get_parent_documents(relevant_chunks)

        # 生成回答
        if stream:
            def generate():
                # 发送源文档信息作为第一个 chunk
                yield json.dumps({"type": "sources", "data": source_info}) + "\n"
                
                if route_type == 'list':
                    response = rag_system.generation_module.generate_list_answer(query, relevant_docs)
                    # 模拟流式
                    for char in response:
                        yield json.dumps({"type": "content", "data": char}) + "\n"
                else:
                    stream_generator = None
                    if route_type == "detail":
                        stream_generator = rag_system.generation_module.generate_step_by_step_answer_stream(query, relevant_docs)
                    else:
                        stream_generator = rag_system.generation_module.generate_basic_answer_stream(query, relevant_docs)
                    
                    for chunk in stream_generator:
                        yield json.dumps({"type": "content", "data": chunk}) + "\n"
            
            return Response(stream_with_context(generate()), mimetype='application/x-ndjson')
        else:
            # 非流式暂未完全实现，建议前端默认使用流式
            return jsonify({"status": "error", "message": "目前仅支持流式输出"}), 501

    except Exception as e:
        logger.error(f"处理查询失败: {e}")
        return jsonify({"status": "error", "message": str(e)}), 500

if __name__ == '__main__':
    app.run(debug=True, port=5000, use_reloader=False)
